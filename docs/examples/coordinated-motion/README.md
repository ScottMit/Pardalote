# Coordinated motion

Two motors sweep **in unison** using a Pardalote [group](../../README.md#groups).
Each motor's type — **PWM servo**, **serial bus servo**, or **stepper** — is
chosen independently from the popup under its dial, so the pair can be **mixed**
(the default is a servo + a stepper). Both motors ping-pong between two positions,
arriving together on every leg. Each dial visualises the motion — a **180° gauge**
for PWM servos, a **360° dial** for bus servos and steppers.

This is the p5.js demonstration of `group.writeTimed()` / `whenDone()`: one call
moves both motors, and each motor type reaches its target its own way (bus
servos via matched-speed SyncWrite, PWM servos via on-board interpolation,
steppers via a board-timed constant-speed move) — all in one WebSocket message.

## Hardware

Any Pardalote board (UNO R4 WiFi or ESP32) plus **two motors of any type**:

| Type | Wiring (defaults — editable under each dial) |
|---|---|
| Servo (PWM) | two servos on pins **5** and **6** |
| Bus Servo (ST) | two Feetech ST servos, IDs **1** and **2**, on the serial bus |
| Stepper (driver) | two STEP/DIR drivers on pins **2,3** and **8,9** |
| Stepper (4-wire) | e.g. 28BYJ-48 via ULN2003 — IN1–IN4 on **8,9,10,11** and **4,5,6,7** |

The Arduino sketch just needs the matching extension(s) included — the simplest
is to include all three so you can switch type without re-flashing:

```cpp
#include <Pardalote.h>
#include <PardaloteServo.h>
#include <PardaloteBusServo.h>
#include <PardaloteStepper.h>

void setup() { Pardalote.begin(); }
void loop()  { Pardalote.run();   }
```

## Browser

This is a **tool** — it works out of the box, no code editing:

1. Open `index.html` in a browser.
2. Type the board's IP into the field at the top and press **Connect**.
3. Pick each motor's type from the popup under its dial and set its pin(s)
   (or bus ID) in the fields below — changes rebuild the group and reconnect.

The browser remembers the IP, motor types, and pins for next time. Without a
connection the dials still preview the sweep.

| Control | Action |
|---|---|
| Popup + pin fields under each dial | choose Servo / Bus Servo / Stepper and its pins/ID for that motor (rebuilds the group) |
| Pause / Resume | stop and start the sweep |
| Duration slider | time per leg — both motors still arrive together |

## Notes

- The dials animate a **display interpolation** of the commanded sweep, so they
  move smoothly even before the board connects (you'll see `status:
  reconnecting…` until it does). The `feedback` readout shows each motor's real
  position once polling returns values (bus servo / stepper).
- The sweep starts each leg from the last commanded position, so the motors are
  snapped to the low pose once on connect (`group.write`) to establish a known
  start — see the note on first moves in the [Groups docs](../../README.md#groups).
- Edit the `low` / `high` values in `TYPES` to change each type's sweep range.
