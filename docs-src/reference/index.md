title: Reference
lede: The full technical documentation — every function on both sides of the wire, the protocol, and the fine print.
---
## Getting started

Setting up boards, libraries and WiFi:

- [Installation](installation.html) — hardware, software, and where the two libraries go
- [WiFi configuration](wifi.html) — compile-time credentials or the Serial Monitor menu

## Core — JavaScript

The browser side of every Pardalote project:

- [Connecting](connecting.html) — `connect()`, events, reconnection, and status
- [Pins and reading](pins.html) — `pinMode`, `digitalWrite`, polled reads, callbacks, and pin aliases

## Core — Arduino

Writing sketch code alongside the browser:

- [The Arduino sketch](arduino.html) — `begin()` / `run()`, `share()` / `send()`, and driving actuators from the sketch

## Extensions

Hardware support, one include at a time:

- [Extensions overview](extensions.html) — registering, script order, firmware includes
- [Servo](servo.html) · [Stepper](stepper.html) · [Bus servo](bus-servo.html) · [Groups](groups.html)
- [NeoPixel](neopixel.html) · [Ultrasonic](ultrasonic.html) · [MPU / IMU](mpu.html) · [Camera](camera.html)

## Under the hood

- [Protocol](protocol.html) — the binary frame format and state sync
- [Troubleshooting](troubleshooting.html) — common issues and their usual fixes

## Conventions used throughout

A few patterns repeat across the whole API:

- **Reads are polls.** The first call to any `read()`-style function starts a periodic poll on the Arduino; subsequent calls return the cached value instantly. Pass an interval to change the rate, or `END` to stop.
- **`target` vs `position`.** Commanded values update immediately; feedback values arrive with polling.
- **Last writer wins.** The browser and the sketch share the same hardware as equals.
- **Setup goes in `on('ready')`.** Attach, init and start polls after the Arduino has synced its state.
