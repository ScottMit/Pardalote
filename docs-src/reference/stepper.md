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

## whenDone()

Promise for the most recent move — resolves `true` when the board reports `done` (or immediately if the move already finished), `false` on the safety timeout (default `max(duration × 2, 10000)` ms; pass `{ timeout }` or a bare number to override, `0` to wait forever). Handy for sequencing. The same method exists on servos, bus servos, and groups.

<div class="sig">await arduino.x.<span class="fn">whenDone</span>([{ timeout }])</div>

```javascript Example — sequence moves
await arduino.x.moveTo(2000).whenDone();
await arduino.x.moveTo(0).whenDone();
```

## moveToTimed()

Runs a **constant-speed** move sized to arrive in about `duration` ms — the board computes the speed from its own exact position. This is what lets steppers **arrive together** inside a [group](groups.html). Constant speed skips the acceleration ramp, so keep the speed reasonable to avoid stalling; use `moveTo()` when arrival timing doesn't matter.

<div class="sig">arduino.x.<span class="fn">moveToTimed</span>(target, duration)</div>

| Parameter | Type | Description |
|---|---|---|
| `target` | number | Absolute position in steps. |
| `duration` | number | Approximate arrival time in ms. |

## gesture()

Plays an authored **segment schedule** — an ordered list of eased moves the board runs back-to-back on its own clock. Where `moveToTimed()` is one constant-speed move, a gesture is a sequence of *eased* ones: the primitive for expressive motion. Each segment's velocity follows its curve (a dedicated on-board eased mode, not AccelStepper's fixed ramp), so you get anticipation, overshoot, and holds a plain ramp can't produce. Values are in **steps**. Fires `done` when the last segment lands.

<div class="sig">arduino.x.<span class="fn">gesture</span>(segments, [opts])</div>

Each segment carries a duration, a curve, and a displacement expressed **either** relatively (`by`) **or** absolutely (`to`):

| Field | Type | Description |
|---|---|---|
| `dur` | number | Segment duration in ms. |
| `curve` | string | `'linear'`, `'easeIn'`, `'easeOut'`, `'easeInOut'`, or `'back'` (overshoot). Default `'linear'`. |
| `by` | number | **Relative** displacement in steps — the default, portable frame. |
| `to` | number | **Absolute** target in steps — use in place of `by`. |

Relative by default (the board captures its live position at the start of each segment). **No homing needed** — a relative bounce works on an open-loop stepper with no position truth, which is the point: a `back` segment drives *past* the target then reverses, a real over-travel (e.g. a lead-screw bounce). Absolute targets are clamped to `setLimits()`. Up to **16** segments. An eased move's velocity peaks above its average, so the board briefly raises the speed cap to hit the authored duration, then restores your `setMaxSpeed()` value.

```javascript Example — a lead-screw bounce, no homing
arduino.x.gesture([
    { by:  800, dur: 350, curve: 'easeOut'   },
    { by: -800, dur: 550, curve: 'easeInOut' },
    { by:  120, dur: 200, curve: 'back'      },   // small overshoot settle
]);
await arduino.x.gesture([ /* … */ ]).whenDone();
```

Any explicit move (`moveTo`, `move`, `runSpeed`, `stop`, `hardStop`, `home`) cancels a running gesture. To coordinate several actuators at once, see [group.gesture()](groups.html#gesture).

## runSpeed()

Continuous rotation at a constant speed until stopped. Sign sets direction.

<div class="sig">arduino.x.<span class="fn">runSpeed</span>(stepsPerSec)</div>

```javascript Example — continuous rotation
arduino.x.runSpeed(600);              // spin at 600 steps/sec
arduino.x.runSpeed(-600);             // reverse
```

## stop()

Decelerates to a stop (position mode) or stops a velocity-mode spin. The motor keeps its coordinate and a `done` follows, so `whenDone()` settles.

<div class="sig">arduino.x.<span class="fn">stop</span>()</div>

## hardStop()

Instant halt with **no deceleration ramp** — unlike `stop()`, the board zeroes speed and distance-to-go in one call. The current position is kept and a `done` follows. Use it for an e-stop, or to end a `runSpeed()` spin without the decel travel. An abrupt stop above the acceleration limit can lose steps, so re-zero afterwards (`setPosition()`) or home if the coordinate matters.

<div class="sig">arduino.x.<span class="fn">hardStop</span>()</div>

## read()

Starts polling position and status. Same poll-and-cache pattern as everywhere else. The board runs the poll (per-browser interval and threshold) and only transmits changes of threshold+ steps.

<div class="sig">arduino.x.<span class="fn">read</span>([interval], [threshold])</div>

| Parameter | Type | Description |
|---|---|---|
| `interval` | number | Optional. Poll interval in ms. Pass `END` to stop. |
| `threshold` | number | Optional. Minimum position change worth transmitting, in steps (`0` = default: `1`). Also settable via `setReadInterval(ms)` / `setReadThreshold(steps)`. |

## setPosition()

Declares the current physical position to be a given value — steppers have no absolute feedback, so move to a reference point (by hand or against a stop) and zero there. For automatic zeroing against an end-stop, see `home()` below.

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

## setLimitSwitch() / clearLimitSwitch()

Hardware end-stops — none, one, or two, one call per switch. The trip happens **on the board** (no WiFi round-trip): moving into a pressed switch stops the motor *instantly* (no deceleration ramp); moving away is always allowed, so you can back off. When a switch trips, a `'limit'` event fires, `limitHit` is set (`'min'`/`'max'`, cleared by the next move), and the normal `'done'` follows — `whenDone()` still settles.

<div class="sig">arduino.x.<span class="fn">setLimitSwitch</span>(which, pin, [trigger]) · arduino.x.<span class="fn">clearLimitSwitch</span>(which)</div>

| Parameter | Type | Description |
|---|---|---|
| `which` | constant | `LIMIT_MIN` or `LIMIT_MAX` — which end of travel the switch guards (same constants as the Arduino side). |
| `pin` | number/string | Switch pin. `-1` clears. |
| `trigger` | constant | `LOW` (default — internal pull-up, wire the switch to GND) or `HIGH`. |

```javascript Example — two end-stops
arduino.x.setLimitSwitch(LIMIT_MIN, 9);          // active LOW
arduino.x.setLimitSwitch(LIMIT_MAX, 10, HIGH);   // active HIGH

arduino.x.on('limit', ({ which, position }) => {
    console.log(`hit the ${which} switch at ${position}`);
});
```

After a trip the step counter is suspect (an instant stop above the acceleration limit can lose steps) — that's what homing is for.

## setSwitchPosition()

Declares where a limit switch physically sits, **as a coordinate**, independent of the soft limits. Homing adopts this value the moment the switch trips, so you can re-establish an accurate counter even after lost steps. The default is `0` — i.e. the switch *is* the origin — so you only need this when home should sit somewhere other than the switch.

<div class="sig">arduino.x.<span class="fn">setSwitchPosition</span>(which, coord)</div>

| Parameter | Type | Description |
|---|---|---|
| `which` | constant | `LIMIT_MIN` or `LIMIT_MAX` — which switch this coordinate belongs to. |
| `coord` | number | The step position the switch sits at. |

```javascript Example — switch 500 steps below home
arduino.x.setLimitSwitch(LIMIT_MIN, 9);      // min-end switch on pin 9
arduino.x.setSwitchPosition(LIMIT_MIN, -500);// it sits 500 steps below home (0)
```

## setHome() / home()

**Home is the origin (`0`).** `setHome()` **re-zeros the frame**: the current spot becomes `0` and the enabled soft limits and switch positions all shift by the same offset, so they keep pointing at the same physical places. `setHome(value)` re-zeros to `value` instead of `0` (rarely needed). `home()` travels back to the origin:

- **With a limit switch** — a board-side routine: seek the switch (MIN if configured, else MAX) at a homing speed (default `maxSpeed/4`, override with `{ speed }`), set the counter to the switch's coordinate (`setSwitchPosition`, default `0`) when it trips, back off until it releases, then travel to the origin. Re-establishes the counter from the switch, so it works even when the counter is wrong.
- **Without a switch** — a plain accel move to the origin (counter trusted).

The seek/back-off legs are **capped** (default 30 s, `{ timeout }` to override): if the switch never trips or never releases, the board hard-stops, fires `'home:fail'` `{ position }`, then `'done'` — nothing spins forever, and `whenDone()` still settles. `done` fires when the travel leg arrives; any explicit move cancels an in-progress routine.

<div class="sig">arduino.x.<span class="fn">setHome</span>([value]) · arduino.x.<span class="fn">home</span>([{ speed, timeout }])</div>

```javascript Example — home against the min switch
arduino.x.setLimitSwitch(LIMIT_MIN, 9);       // min-end switch on pin 9
arduino.x.setSwitchPosition(LIMIT_MIN, -500); // it sits 500 steps below home

await arduino.x.home().whenDone({ timeout: 30000 });   // seeks it, then travels to 0
```

This is the CNC/work-coordinate split: the switch is a fixed physical reference, home is your `0` at a known offset from it. With the default switch position (`0`) the switch simply *is* home.

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
| `'change'` | `{ position, distanceToGo, speed, isRunning }` | The position changed by at least the threshold. |
| `'done'` | `{ position }` | A position-mode target, timed move, or gesture finishes (or motion ends at a limit switch). |
| `'move'` | `{ target }` | THIS page issued a move (including group moves it participates in) — a command echo, like servo `'write'`. Other browsers' moves arrive via the read stream and `'done'`/`'limit'`, not `'move'`. `runSpeed()` emits nothing (continuous rotation has no destination). |
| `'limit'` | `{ which, position }` | A limit switch tripped and the board hard-stopped the motor. |
| `'home:fail'` | `{ position }` | Homing gave up (seek/back-off timeout) — the switch never responded. |
| `'gesturestart'` / `'gestureend'` | `{}` | The board starts / ends playing a schedule on this stepper — **any** origin (this browser, another, or the sketch). End = completion or a superseding move. |

Shorthand: `onChange(fn)`, `onDone(fn)`, `onMove(fn)`, `onLimit(fn)`, `onHomeFail(fn)`, `onGestureStart(fn)`, `onGestureEnd(fn)`. The `isGesturing` property tracks whether a schedule is playing (any origin).

## Properties and state

| Property | Description |
|---|---|
| `arduino.x.position` | Cached current position (steps) — real feedback, needs polling. |
| `arduino.x.target` | Commanded destination — set immediately by `moveTo()`. |
| `arduino.x.distanceToGo` | Steps remaining to target. |
| `arduino.x.speed` | Current speed (steps/sec). |
| `arduino.x.isRunning` | Boolean. |
| `arduino.x.isGesturing` | `true` while the board is playing a segment schedule on this stepper (any origin). |

`target` vs `position`: `moveTo(n)` sets `target` to `n` **right away**, so you can show where it's headed without waiting for a poll; `position` is real feedback and only advances toward `target` as read polls (or the `done` event) arrive. `target` also self-corrects from read feedback — so it stays right even when the *Arduino sketch* issued the move.

<div class="sig">arduino.x.<span class="fn">getState</span>()</div>

**Returns** `{ logicalId, interface, pins, enPin, attached, maxSpeed, acceleration, stepsPerRev, target, position, distanceToGo, speed, isRunning, limits, interval }`.

See also: [Groups](groups.html) · [Stepper example](../examples/stepper-motor.html) · [Troubleshooting](troubleshooting.html)
