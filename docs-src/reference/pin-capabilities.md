title: Pin capabilities
lede: What each pin can actually do on the supported boards — analog in, digital in/out, PWM — and the gotchas that come from the silicon, not from Pardalote.
---
Not every pin does everything. A pin's capabilities come from the chip and the board, not from Pardalote, so `analogRead()` on the wrong pin returns `0` and `analogWrite()` on an input-only pin does nothing — even though the call itself is valid. These tables say which pins to reach for.

The legend for every table: **✓** works, **—** not available. "Analog in" means `analogRead()` / `ANALOG_INPUT_MODE`; "PWM" means `analogWrite()`.

> **Bench status.** The **ESP32-WROVER** and **UNO R4 WiFi** tables are confirmed on real hardware (Scott's rig, 2026-07). The **FireBeetle 2 ESP32-C5** table is derived from the datasheet and the Pardalote pin-alias file — correct by the docs, but not yet bench-verified pin by pin.

## Concepts that explain the tables

**Input-only pins.** On the classic ESP32, GPIO 34–39 can only read — no `digitalWrite`, no `analogWrite`, and crucially **no internal pull-up or pull-down**, so a floating input-only pin needs an external resistor. This is why those pins show read ✓ but output —.

**ADC2 dies while WiFi is on.** The original ESP32 has two ADC units. **ADC1** works whenever; **ADC2** is borrowed by the WiFi radio and reads `0` the entire time WiFi is connected. Pardalote is *always* on WiFi, so on the WROVER every ADC2 pin is effectively analog-dead — that's expected, not a fault. Only the ADC1 pins give real readings. The UNO R4 and the ESP32-C5 don't have this split on their exposed analog pins, so their analog pins stay readable with WiFi up.

**PWM is a shared resource, not a pin property.** On the ESP32 the LEDC peripheral can route PWM to almost any output-capable pin, so "PWM" tracks "can this pin output at all." On the ESP32-C5 there are only **6 LEDC channels**, so at most six pins can PWM at once. On the UNO R4 WiFi, PWM is fixed to the six timer-backed header pins marked `~` (3, 5, 6, 9, 10, 11).

**Strapping and reserved pins.** A few pins are read by the chip at boot to decide boot mode (strapping pins: WROVER 0, 2, 5, 12, 15) and can misbehave if you hold them at the wrong level during reset. Others are physically unavailable because they're wired to flash or PSRAM (WROVER GPIO 6–11 for flash, 16–17 for PSRAM) — those aren't broken out for general use and aren't listed below.

## ESP32-WROVER-DEV

Include `pardalote-pins-esp32-wrover-dev.js`. `arduino.analogMax` = **4095**. Confirmed on hardware.

| GPIO | Alias | Analog in | Digital in | Digital out | PWM | Notes |
|---|---|:---:|:---:|:---:|:---:|---|
| 0  | A11 | — | ✓ | ✓ | ✓ | ADC2 (dead on WiFi); strapping (boot button) |
| 2  | A12 | — | ✓ | ✓ | ✓ | ADC2 (dead on WiFi); strapping; onboard LED (`LED_BUILTIN`) |
| 4  | A10 | — | ✓ | ✓ | ✓ | ADC2 (dead on WiFi) |
| 5  | SS  | — | ✓ | ✓ | ✓ | No ADC; strapping |
| 12 | A15 | — | ✓ | ✓ | ✓ | ADC2 (dead on WiFi); strapping (must be LOW at boot) |
| 13 | A14 | — | ✓ | ✓ | ✓ | ADC2 (dead on WiFi) |
| 14 | A16 | — | ✓ | ✓ | ✓ | ADC2 (dead on WiFi) |
| 15 | A13 | — | ✓ | ✓ | ✓ | ADC2 (dead on WiFi); strapping |
| 18 | SCK | — | ✓ | ✓ | ✓ | No ADC |
| 19 | MISO| — | ✓ | ✓ | ✓ | No ADC |
| 21 | SDA | — | ✓ | ✓ | ✓ | No ADC; default I2C SDA |
| 22 | SCL | — | ✓ | ✓ | ✓ | No ADC; default I2C SCL |
| 23 | MOSI| — | ✓ | ✓ | ✓ | No ADC |
| 25 | A18 | — | ✓ | ✓ | ✓ | ADC2 (dead on WiFi); true DAC out (`DAC1`) |
| 26 | A19 | — | ✓ | ✓ | ✓ | ADC2 (dead on WiFi); true DAC out (`DAC2`) |
| 27 | A17 | — | ✓ | ✓ | ✓ | ADC2 (dead on WiFi) |
| 32 | A4  | ✓ | ✓ | ✓ | ✓ | ADC1 — analog works on WiFi |
| 33 | A5  | ✓ | ✓ | ✓ | ✓ | ADC1 — analog works on WiFi |
| 34 | A6  | ✓ | ✓ | — | — | Input-only; no pull-up/pull-down |
| 35 | A7  | ✓ | ✓ | — | — | Input-only; no pull-up/pull-down |
| 36 | A0  | ✓ | ✓ | — | — | Input-only; no pull-up/pull-down (SVP) |
| 39 | A3  | ✓ | ✓ | — | — | Input-only; no pull-up/pull-down (SVN) |

The one thing worth memorising: **the only pins that read analog under WiFi are 32, 33, 34, 35, 36, 39** (the ADC1 set). Everything labelled "ADC2" reads `0` while connected. GPIO 1/3 (UART to USB), 6–11 (flash) and 16–17 (PSRAM) are not broken out.

## Arduino UNO R4 WiFi

Include `pardalote-pins-uno-r4-wifi.js`. `arduino.analogMax` = **1023** (10-bit default; the RA4M1 ADC can do 12/14-bit). Confirmed on hardware. No input-only pins, and no ADC/WiFi conflict.

| Pin | Alias | Analog in | Digital in | Digital out | PWM | Notes |
|---|---|:---:|:---:|:---:|:---:|---|
| 0  | D0  | — | ✓ | ✓ | — | Serial1 RX |
| 1  | D1  | — | ✓ | ✓ | — | Serial1 TX |
| 2  | D2  | — | ✓ | ✓ | — |  |
| 3  | D3  | — | ✓ | ✓ | ✓ | `~` PWM |
| 4  | D4  | — | ✓ | ✓ | — |  |
| 5  | D5  | — | ✓ | ✓ | ✓ | `~` PWM |
| 6  | D6  | — | ✓ | ✓ | ✓ | `~` PWM |
| 7  | D7  | — | ✓ | ✓ | — |  |
| 8  | D8  | — | ✓ | ✓ | — |  |
| 9  | D9  | — | ✓ | ✓ | ✓ | `~` PWM |
| 10 | D10 | — | ✓ | ✓ | ✓ | `~` PWM |
| 11 | D11 | — | ✓ | ✓ | ✓ | `~` PWM |
| 12 | D12 | — | ✓ | ✓ | — |  |
| 13 | D13 | — | ✓ | ✓ | — | Onboard LED (`LED_BUILTIN`) |
| 14 | A0  | ✓ | ✓ | ✓ | — | Also the board's true DAC output |
| 15 | A1  | ✓ | ✓ | ✓ | — | Op-amp + input (if enabled) |
| 16 | A2  | ✓ | ✓ | ✓ | — | Op-amp − input (if enabled) |
| 17 | A3  | ✓ | ✓ | ✓ | — | Op-amp output (if enabled) |
| 18 | A4  | ✓ | ✓ | ✓ | — | I2C SDA — avoid analog while I2C is in use |
| 19 | A5  | ✓ | ✓ | ✓ | — | I2C SCL — avoid analog while I2C is in use |

## FireBeetle 2 ESP32-C5

Include `pardalote-pins-firebeetle2-esp32-c5.js`. `arduino.analogMax` = **4095**. Datasheet-derived — not yet bench-verified. A single 12-bit SAR ADC (no ADC2/WiFi split), and a 6-channel LED PWM controller (at most six PWM outputs at once).

| GPIO | Alias | Analog in | Digital in | Digital out | PWM | Notes |
|---|---|:---:|:---:|:---:|:---:|---|
| 2  | A1  | ✓ | ✓ | ✓ | ✓ | ADC — readable on WiFi |
| 3  | A2  | ✓ | ✓ | ✓ | ✓ | ADC — readable on WiFi |
| 4  | A3  | ✓ | ✓ | ✓ | ✓ | ADC — readable on WiFi |
| 5  | A4  | ✓ | ✓ | ✓ | ✓ | ADC — readable on WiFi |
| 6  | D12 | — | ✓ | ✓ | ✓ |  |
| 7  | D11 | — | ✓ | ✓ | ✓ |  |
| 8  | D2  | — | ✓ | ✓ | ✓ |  |
| 9  | SDA | — | ✓ | ✓ | ✓ | Default I2C SDA |
| 10 | SCL | — | ✓ | ✓ | ✓ | Default I2C SCL |
| 11 | TX  | — | ✓ | ✓ | ✓ | UART TX |
| 12 | RX  | — | ✓ | ✓ | ✓ | UART RX |
| 15 | D13 | — | ✓ | ✓ | ✓ | Onboard LED (`LED_BUILTIN`) |
| 23 | SCK | — | ✓ | ✓ | ✓ | SPI clock |
| 24 | MOSI| — | ✓ | ✓ | ✓ | SPI MOSI |
| 25 | MISO| — | ✓ | ✓ | ✓ | SPI MISO |
| 26 | D3  | — | ✓ | ✓ | ✓ |  |
| 27 | D6  | — | ✓ | ✓ | ✓ | Also `SS` |
| 28 | D9  | — | ✓ | ✓ | ✓ | BOOT button (strapping) |

Board-level pins to know: **GPIO 0** switches the on-board `3V3_C` power rail (default off, drive HIGH to enable), and **IO1** senses the battery voltage — both are wired to on-board functions rather than free header I/O.

## Picking a pin quickly

For an **analog sensor** with WiFi running, use an ADC1 pin — WROVER 32/33/34/35/36/39, or any exposed analog pin on the UNO R4 (A0–A5) and the C5 (A1–A4). For a **button**, any pin with digital-in ✓; prefer one with an internal pull-up (i.e. *not* WROVER 34–39) so you can wire the switch to GND with no external resistor. For **PWM** (LED dimming, plain servo pins), any pin with PWM ✓ — on the C5, remember only six can run at once. Avoid the strapping pins for anything that's driven at boot.

See also: [Pins and reading](pins.html) · [Protocol](protocol.html) · [Troubleshooting](troubleshooting.html)
