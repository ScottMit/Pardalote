title: Bus servo
lede: Up to 16 smart serial servos on one shared UART — position, speed, torque control and rich feedback, Feetech ST and SC series.
---
Requires the Feetech/Waveshare `SCServo` library and `<PardaloteBusServo.h>` in the sketch. Supports Feetech **ST / SMS** series (0–4095 counts, e.g. the **STS3215** used in the LeRobot SO-100/SO-101 arms) and **SC / SCS** series (0–1023 counts).

Unlike PWM servos, every bus servo shares **one UART** and is addressed by a hardware **servo ID (1–253)**, and **positions are raw encoder counts, not degrees**. Wiring is via a Waveshare Serial Bus Servo Driver board (or equivalent) on a hardware serial port: UNO R4 WiFi → `Serial1` (D0/D1), ESP32 → `Serial1`/`Serial2`.

Give the servos their own power supply (6–7.4 V typical) — not the board's 5 V rail. Examples assume:

```javascript sketch.js — register a bus servo
arduino.add('shoulder', new BusServo());
```

## configureBus()

Optional bus configuration — defaults to `Serial1` at 1 Mbps, brought up lazily on first `attach()`. Call once from any instance; it affects all bus servos.

<div class="sig">arduino.shoulder.<span class="fn">configureBus</span>(options)</div>

| Option | Type | Description |
|---|---|---|
| `serial` | number | Hardware serial port number (default `1`). |
| `baud` | number | Bus speed (default `1000000`). |
| `rxPin`, `txPin` | number | ESP32 only: custom UART pins. |

```javascript Example — configure the bus
arduino.shoulder.configureBus({ serial: 1, baud: 1000000 });
arduino.shoulder.configureBus({ rxPin: 18, txPin: 19 });   // ESP32 custom pins
```

## attach()

Binds this instance to a servo ID on the bus. Call inside `on('ready')`.

<div class="sig">arduino.shoulder.<span class="fn">attach</span>(id, [series])</div>

| Parameter | Type | Description |
|---|---|---|
| `id` | number | Hardware servo ID, `1`–`253`. Servos ship as ID 1. |
| `series` | string | Optional. `'ST'` (0–4095, default) or `'SC'` (0–1023). |

```javascript Example — attach by servo ID
arduino.shoulder.attach(1);
arduino.wrist.attach(3, 'SC');
```

## detach()

Releases torque and unbinds the instance.

<div class="sig">arduino.shoulder.<span class="fn">detach</span>()</div>

## write()

Moves to a position in raw counts, with optional per-move speed and acceleration.

<div class="sig">arduino.shoulder.<span class="fn">write</span>(counts, [options])</div>

| Parameter | Type | Description |
|---|---|---|
| `counts` | number | Target position: ST `0`–`4095`, SC `0`–`1023`. |
| `options` | object | Optional. `{ speed, acc }` for this move. |

```javascript Example — position moves
arduino.shoulder.write(2048);                        // centre
arduino.shoulder.write(3000, { speed: 3000, acc: 50 });
```

## writeDegrees()

Degree convenience wrapper — accurate for ST (4096/360°), nominal for SC.

<div class="sig">arduino.shoulder.<span class="fn">writeDegrees</span>(degrees)</div>

## center()

Moves to the middle of the range (`resolution / 2`, i.e. 2048 for ST).

<div class="sig">arduino.shoulder.<span class="fn">center</span>()</div>

## setMoveDefaults()

Sets the default speed and acceleration used by plain `write()`, group `set()` and `moveTo()`.

<div class="sig">arduino.shoulder.<span class="fn">setMoveDefaults</span>(speed, acc)</div>

## writeTimed()

Reaches a position in about a set time — the speed is picked from the move distance. What lets bus servos **arrive together** in a [group](groups.html).

<div class="sig">arduino.shoulder.<span class="fn">writeTimed</span>(counts, duration)</div>

| Parameter | Type | Description |
|---|---|---|
| `counts` | number | Target position in counts. |
| `duration` | number | Approximate arrival time in ms. |

## stop()

Halts the servo — holds the last-read position.

<div class="sig">arduino.shoulder.<span class="fn">stop</span>()</div>

## setMode() / writeSpeed()

Wheel mode for continuous rotation.

<div class="sig">arduino.shoulder.<span class="fn">setMode</span>(mode) · arduino.shoulder.<span class="fn">writeSpeed</span>(speed)</div>

| Parameter | Type | Description |
|---|---|---|
| `mode` | string | `'wheel'` or `'position'`. |
| `speed` | number | Rotation speed; sign sets direction, `0` stops. |

```javascript Example — wheel mode
arduino.wheel.setMode('wheel');
arduino.wheel.writeSpeed(2000);
arduino.wheel.writeSpeed(0);
arduino.wheel.setMode('position');
```

## enableTorque() / disableTorque()

Hold position, or go limp. Disabling torque lets you move a joint by hand while `read()` streams the position — the basis of the teach-a-trajectory workflow in projects like LeRobot.

<div class="sig">arduino.shoulder.<span class="fn">enableTorque</span>() · arduino.shoulder.<span class="fn">disableTorque</span>()</div>

## read()

Starts polling feedback. One bus transaction per poll returns position, velocity, load, voltage, temperature, and (ST) current.

<div class="sig">arduino.shoulder.<span class="fn">read</span>([interval])</div>

| Parameter | Type | Description |
|---|---|---|
| `interval` | number | Optional. Poll interval in ms. Pass `END` to stop. |

## setLimits()

Position limits, written into the servo's own registers — so the **servo enforces them** even without the browser in the loop.

<div class="sig">arduino.shoulder.<span class="fn">setLimits</span>(min, max)</div>

## calibrate()

Declares the servo's current physical position as centre. Move the joint to its zero pose by hand (torque off) first.

<div class="sig">arduino.shoulder.<span class="fn">calibrate</span>()</div>

## scan() / ping() / setId()

Bus utilities. Servos ship as ID 1 — to renumber, put a **single** servo on the bus and call `setId()`, one servo at a time.

<div class="sig">await arduino.shoulder.<span class="fn">scan</span>(from, to) · await arduino.shoulder.<span class="fn">ping</span>(id) · arduino.shoulder.<span class="fn">setId</span>(newId)</div>

| Function | Returns |
|---|---|
| `scan(from, to)` | Array of responding IDs in the range, e.g. `[1, 2, 3]`. |
| `ping(id)` | `true` / `false`. |
| `setId(newId)` | Renumbers the currently addressed servo. **One servo on the bus only** — with several servos sharing an ID, they'd all take the new one. |

## Properties and state

| Property | Description |
|---|---|
| `arduino.shoulder.position` | Raw counts — real feedback, needs polling. |
| `arduino.shoulder.target` | Commanded goal — set immediately by `write()`. |
| `arduino.shoulder.positionDegrees` | Position converted to degrees. |
| `arduino.shoulder.velocity` | From feedback. |
| `arduino.shoulder.load` | From feedback. |
| `arduino.shoulder.voltage` | Volts. |
| `arduino.shoulder.temperature` | °C. |
| `arduino.shoulder.current` | Raw units (ST only). |

`target` vs `position`: `write(n)` sets `target` immediately (where you told it to go); `position` is real encoder feedback and only tracks toward `target` while you're polling. Unlike the stepper, bus-servo `target` is browser-side only — the servo has no board-replayed goal, so it isn't restored after a board reset.

## Events

| Event | Payload |
|---|---|
| `'read'` | `{ position, velocity, load, voltage, temperature }` |

<div class="sig">arduino.shoulder.<span class="fn">getState</span>()</div>

**Returns** `{ logicalId, servoId, series, attached, mode, torque, resolution, target, position, velocity, load, voltage, temperature, current, limits, interval }`.

See also: [Groups](groups.html) · [Bus servo example](../examples/busservo-example.html) · [Troubleshooting](troubleshooting.html)
