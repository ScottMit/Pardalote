title: Stepper
lede: Up to 6 stepper motors with accel-limited moves, continuous rotation, soft limits and live position — motion runs on the Arduino.
---
Requires the `AccelStepper` library and `<PardaloteStepper.h>` in the sketch. Works with STEP/DIR drivers (**TMC2208**, **TMC2209**, **A4988**, **EasyDriver**) and 4-wire coil drivers (28BYJ-48 via ULN2003, bipolar via H-bridge).

**Motion runs on the Arduino.** You send targets and motion profiles; the board generates the step pulses via `AccelStepper::run()`. You never stream individual steps over WiFi — that's why the API mirrors AccelStepper (non-blocking) rather than the built-in `Stepper` library, whose `step()` blocks and would stall the connection mid-move.

Give the motor its own power supply — don't run the coils off the board's 5 V rail. Examples assume:

```javascript sketch.js — register a stepper
arduino.add('x', new Stepper());
```

## attach()

Attaches a STEP/DIR driver. Call inside `on('ready')`.

<div class="sig">arduino.x.<span class="fn">attach</span>(step, dir, [en], [options])</div>

| Parameter | Type | Description |
|---|---|---|
| `step` | number \| string | STEP pin. |
| `dir` | number \| string | DIR pin. |
| `en` | number \| string | Optional. Enable pin (treated as active-LOW by default). |
| `options` | object | Optional. `{ invertDir, invertEnable }` booleans to flip signal polarity. |

```javascript Example — attach a driver
arduino.x.attach(2, 3);                                    // no enable pin
arduino.x.attach(2, 3, 4);                                 // with enable pin
arduino.x.attach(2, 3, 4, { invertDir: true });            // runs backwards? flip it
```

## attach4wire()

Attaches a 4-wire coil driver (28BYJ-48 via ULN2003, or bipolar via H-bridge).

<div class="sig">arduino.x.<span class="fn">attach4wire</span>(in1, in2, in3, in4)</div>

| Parameter | Type | Description |
|---|---|---|
| `in1`–`in4` | number \| string | The four coil driver pins. |

## detach()

Releases the pins.

<div class="sig">arduino.x.<span class="fn">detach</span>()</div>

## setMaxSpeed() / setAcceleration()

Sets the motion profile. Both must be non-zero before any move happens.

<div class="sig">arduino.x.<span class="fn">setMaxSpeed</span>(stepsPerSec) · arduino.x.<span class="fn">setAcceleration</span>(stepsPerSec2)</div>

| Parameter | Type | Description |
|---|---|---|
| `stepsPerSec` | number | Speed ceiling for moves. Software step generation shares the CPU with WiFi and tops out at a few kHz. |
| `stepsPerSec2` | number | Acceleration / deceleration rate. |

## moveTo() / move()

Accel-limited moves to an absolute or relative target.

<div class="sig">arduino.x.<span class="fn">moveTo</span>(target) · arduino.x.<span class="fn">move</span>(delta)</div>

| Parameter | Type | Description |
|---|---|---|
| `target` | number | Absolute position in steps. |
| `delta` | number | Steps relative to the current position (negative = reverse). |

## moveToAsync()

Promise variant of `moveTo()` — resolves when the move completes. Handy for sequencing.

<div class="sig">await arduino.x.<span class="fn">moveToAsync</span>(target)</div>

```javascript Example — sequence moves
await arduino.x.moveToAsync(2000);
await arduino.x.moveToAsync(0);
```

## moveToTimed()

Runs a **constant-speed** move sized to arrive in about `duration` ms — the board computes the speed from its own exact position. This is what lets steppers **arrive together** inside a [group](groups.html). Constant speed skips the acceleration ramp, so keep the speed reasonable to avoid stalling; use `moveTo()` when arrival timing doesn't matter.

<div class="sig">arduino.x.<span class="fn">moveToTimed</span>(target, duration)</div>

| Parameter | Type | Description |
|---|---|---|
| `target` | number | Absolute position in steps. |
| `duration` | number | Approximate arrival time in ms. |

## runSpeed()

Continuous rotation at a constant speed until stopped. Sign sets direction.

<div class="sig">arduino.x.<span class="fn">runSpeed</span>(stepsPerSec)</div>

```javascript Example — continuous rotation
arduino.x.runSpeed(600);              // spin at 600 steps/sec
arduino.x.runSpeed(-600);             // reverse
```

## stop()

Decelerates to a stop (position mode) or stops a velocity-mode spin.

<div class="sig">arduino.x.<span class="fn">stop</span>()</div>

## read()

Starts polling position and status. Same poll-and-cache pattern as everywhere else.

<div class="sig">arduino.x.<span class="fn">read</span>([interval])</div>

| Parameter | Type | Description |
|---|---|---|
| `interval` | number | Optional. Poll interval in ms. Pass `END` to stop. |

## setPosition()

Declares the current physical position to be a given value — steppers have no absolute feedback, so move to a reference point (by hand or against a stop) and zero there. Limit-switch homing is planned for a future version.

<div class="sig">arduino.x.<span class="fn">setPosition</span>(steps)</div>

```javascript Example — declare home
arduino.x.setPosition(0);             // "here is home"
```

## enable() / disable()

Drives the enable pin: energise the coils to hold position, or release them so the shaft turns freely by hand (and stops heating up).

<div class="sig">arduino.x.<span class="fn">enable</span>() · arduino.x.<span class="fn">disable</span>()</div>

## setLimits() / clearLimits()

Soft limits, enforced **on the Arduino** — every target is clamped to the range before the board acts on it. The browser (or an LLM driving it) can't send the motor past the set bounds.

<div class="sig">arduino.x.<span class="fn">setLimits</span>(min, max) · arduino.x.<span class="fn">clearLimits</span>()</div>

| Parameter | Type | Description |
|---|---|---|
| `min`, `max` | number | Allowed position range in steps. |

## Degrees and revolutions

Convenience helpers convert to raw steps on the JS side. Set steps-per-revolution to match your microstepping first (a 1.8° motor at 16 microsteps = 200 × 16 = 3200):

<div class="sig">arduino.x.<span class="fn">setStepsPerRev</span>(steps)</div>

```javascript Example — work in degrees
arduino.x.setStepsPerRev(200 * 16);
arduino.x.moveToDegrees(90);          // absolute
arduino.x.moveDegrees(-45);           // relative
arduino.x.moveToRevolutions(2);
arduino.x.moveRevolutions(0.5);
```

## Events

<div class="sig">arduino.x.<span class="fn">on</span>(event, handler)</div>

| Event | Payload | Fires when |
|---|---|---|
| `'read'` | `{ position, distanceToGo, speed, isRunning }` | A poll result arrives. |
| `'done'` | `{ position }` | A position-mode target is reached. |
| `'move'` | `{ target }` | A move is issued. |

Shorthand: `onRead(fn)`, `onDone(fn)`, `onMove(fn)`.

## Properties and state

| Property | Description |
|---|---|
| `arduino.x.position` | Cached current position (steps) — real feedback, needs polling. |
| `arduino.x.target` | Commanded destination — set immediately by `moveTo()`. |
| `arduino.x.distanceToGo` | Steps remaining to target. |
| `arduino.x.speed` | Current speed (steps/sec). |
| `arduino.x.isRunning` | Boolean. |

`target` vs `position`: `moveTo(n)` sets `target` to `n` **right away**, so you can show where it's headed without waiting for a poll; `position` is real feedback and only advances toward `target` as read polls (or the `done` event) arrive. `target` also self-corrects from read feedback — so it stays right even when the *Arduino sketch* issued the move.

<div class="sig">arduino.x.<span class="fn">getState</span>()</div>

**Returns** `{ logicalId, interface, pins, enPin, attached, maxSpeed, acceleration, stepsPerRev, target, position, distanceToGo, speed, isRunning, limits, interval }`.

See also: [Groups](groups.html) · [Stepper example](../examples/stepper-example.html) · [Troubleshooting](troubleshooting.html)
