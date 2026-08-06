title: Reference
lede: The full technical documentation — every function on both sides of the wire, the protocol, and the fine print.
---
## Getting started

Setting up boards, libraries and the connection:

- [Installation](installation.html) — hardware, software, and where the two libraries go
- [WiFi configuration](wifi.html) — compile-time credentials or the Serial Monitor menu (skip this page for USB serial)
- [Coding with AI](ai-coding.html) — the whole reference as one file to paste into an AI assistant

## Core — JavaScript

The browser side of every Pardalote project:

- [Connecting](connecting.html) — `connect()` and `connectSerial()` (WiFi or USB), connection keys, events, reconnection, and status
- [Pins and reading](pins.html) — `pinMode`, `digitalWrite`, polled reads, callbacks, and pin aliases

## Core — Arduino

Writing sketch code alongside the browser:

- [The Arduino sketch](arduino.html) — `begin()` / `run()`, `share()` / `send()`

## Core — Messaging

A key/value channel for everything that isn't a pin or a device — symmetric between browser and sketch:

- [Messaging](messaging.html) — `send()` / `watch()`, retain and broadcast, and the frame monitor ([JavaScript to Arduino](messaging.html#javascript-to-arduino) · [Arduino to JavaScript](messaging.html#arduino-to-javascript))

## Extensions

Hardware support, one include at a time:

- [Extensions overview](extensions.html) — registering, script order, firmware includes, creating objects from the sketch, and [reading actuators](extensions.html#reading-and-writing-actuators-from-the-sketch)
- [Servo](servo.html) · [Stepper](stepper.html) · [Bus servo](bus-servo.html) · [Groups](groups.html)
- [NeoPixel](neopixel.html) · [Ultrasonic](ultrasonic.html) · [Rotary encoder](encoder.html) · [IMU](imu.html) · [Camera](camera.html)

## Under the hood

- [Protocol](protocol.html) — the binary frame format and state sync
- [Pin capabilities](pin-capabilities.html) — what each pin can do, per board, and the silicon gotchas
- [Troubleshooting](troubleshooting.html) — common issues and their usual fixes

## Conventions used throughout

A few patterns repeat across the whole API:

- **Reads are polls.** The first call to any `read()`-style function starts a periodic poll on the Arduino; subsequent calls return the cached value instantly. Pass an interval to change the rate, or `END` to stop.
- **`target` vs `position`.** Commanded values update immediately; feedback values arrive with polling.
- **Last writer wins.** The browser and the sketch share the same hardware as equals.
- **Setup goes in `on('ready')`.** Attach, init and start polls after the Arduino has synced its state.
- **Motion runs on the board.** Timed moves and `gesture()` schedules are played on the Arduino's own clock — never streamed step-by-step — so they stay smooth and survive a WiFi blip. See each actuator's `gesture()` and [Groups](groups.html#gesture).
