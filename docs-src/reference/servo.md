title: Servo
lede: Drive up to 8 PWM hobby servos from the browser — with smooth sweeps, timed moves, and angle read-back.
---
Requires `<PardaloteServo.h>` in the sketch (plus the `ESP32Servo` library on ESP32). Register instances before connecting; examples assume:

```javascript
arduino.add('pan', new Servo());
```

Alternatively, the **sketch** can create the servo — `PardaloteServo.attach("pan", 9)` on the Arduino — and `arduino.pan` appears automatically, no `add()` needed: a full `Servo` instance, identical to the above, present before `'ready'` fires. See [The Arduino sketch](arduino.html#creating-actuators-from-the-sketch).

## attach()

Attaches the servo to a pin. Call inside `on('ready')`.

<div class="sig">arduino.pan.<span class="fn">attach</span>(pin, [minPulse], [maxPulse])</div>

| Parameter | Type | Description |
|---|---|---|
| `pin` | number \| string | PWM-capable pin the servo signal wire is on. |
| `minPulse` | number | Optional. Pulse width at 0°, in µs (default `544`). |
| `maxPulse` | number | Optional. Pulse width at 180°, in µs (default `2400`). |

```javascript Example — attach a servo
arduino.pan.attach(9);
arduino.pan.attach(9, 544, 2400);   // custom pulse range
```

## detach()

Releases the pin.

<div class="sig">arduino.pan.<span class="fn">detach</span>()</div>

## write()

Moves the servo to an angle. Cancels any in-progress sweep or timed move.

<div class="sig">arduino.pan.<span class="fn">write</span>(angle)</div>

| Parameter | Type | Description |
|---|---|---|
| `angle` | number | Target angle, `0`–`180` degrees. |

## writeMicroseconds()

Fine-grained control via raw pulse width.

<div class="sig">arduino.pan.<span class="fn">writeMicroseconds</span>(us)</div>

| Parameter | Type | Description |
|---|---|---|
| `us` | number | Pulse width in microseconds, typically `544`–`2400`. |

## center() / min() / max()

Shorthand moves.

<div class="sig">arduino.pan.<span class="fn">center</span>() · arduino.pan.<span class="fn">min</span>() · arduino.pan.<span class="fn">max</span>()</div>

Move to 90°, 0°, and 180° respectively.

## read()

Reads the servo's angle. Same poll-and-cache pattern as `analogRead()`: the first call starts a poll, later calls return the cached value.

<div class="sig">arduino.pan.<span class="fn">read</span>([interval])</div>

| Parameter | Type | Description |
|---|---|---|
| `interval` | number | Optional. Poll interval in ms. Pass `END` to stop. |

**Returns** the cached angle in degrees.

What the Arduino reports depends on the platform:

- **UNO R4 WiFi:** the last commanded angle (the Arduino Servo library's `read()` is just a getter).
- **ESP32:** the angle decoded from the LEDC PWM duty register. Usually matches the commanded angle, but the hardware round-trip can return values slightly off, and a `write()` during a `read()` can briefly return a transitional value.

If you just want "what did I tell the servo to do?" — use the `angle` property (locally cached, updated on every `write()`).

## sweep()

Sweeps between two angles over a duration, streaming intermediate writes. Returns a promise. Any `write()` cancels it.

<div class="sig">await arduino.pan.<span class="fn">sweep</span>(from, to, duration, [steps])</div>

| Parameter | Type | Description |
|---|---|---|
| `from` | number | Start angle. |
| `to` | number | End angle. |
| `duration` | number | Sweep time in ms. |
| `steps` | number | Optional. Number of intermediate writes (default `50`). More = smoother. |

```javascript Example — smooth sweep
await arduino.pan.sweep(0, 180, 2000);
```

## writeTimed()

Moves to an angle over a set time — the Arduino interpolates on-board (smooth, no WiFi streaming) and fires `done` on arrival. The modern replacement for `sweep()`, and what lets PWM servos **arrive together** inside a [group](groups.html).

<div class="sig">arduino.pan.<span class="fn">writeTimed</span>(angle, duration)</div>

| Parameter | Type | Description |
|---|---|---|
| `angle` | number | Target angle, `0`–`180`. |
| `duration` | number | Move time in ms. |

```javascript Example — timed move with a done event
arduino.pan.writeTimed(120, 1500);   // move to 120° over 1.5 s
arduino.pan.on('done', ({ angle }) => { /* arrived */ });
```

An immediate `write()` cancels an in-progress timed move.

## whenDone()

Promise for the most recent timed move — resolves `true` on the servo's `done` (or immediately if no move is pending), `false` on the safety timeout (default `max(duration × 2, 10000)` ms; pass `{ timeout }` or a bare number to override, `0` to wait forever). The same method exists on steppers, bus servos, and groups.

<div class="sig">await arduino.pan.<span class="fn">whenDone</span>([{ timeout }])</div>

```javascript Example — sequence timed moves
await arduino.pan.writeTimed(120, 1500).whenDone();
await arduino.pan.writeTimed(60,  1500).whenDone();
```

## stop()

Cancels a timed move and holds the current angle.

<div class="sig">arduino.pan.<span class="fn">stop</span>()</div>

## setLimits() / clearLimits()

Soft angle limits, enforced **on the Arduino** — every commanded angle (browser write, sketch write, timed or group move) is clamped to the range before it reaches the servo. Same shape as `setLimits` on the stepper and bus servo.

<div class="sig">arduino.pan.<span class="fn">setLimits</span>(min, max) · arduino.pan.<span class="fn">clearLimits</span>()</div>

| Parameter | Type | Description |
|---|---|---|
| `min`, `max` | number | Allowed angle range, `0`–`180`. |

## setHome() / home()

`setHome(angle)` declares the home angle — no-arg means "the current angle is home". `home()` snaps there; `home(duration)` glides there over `duration` ms. Default home is `90` (centre). Same pair as the stepper and bus servo.

<div class="sig">arduino.pan.<span class="fn">setHome</span>([angle]) · arduino.pan.<span class="fn">home</span>([duration])</div>

```javascript Example — ease home
arduino.pan.setHome(45);
await arduino.pan.home(1000).whenDone();
```

## Events

<div class="sig">arduino.pan.<span class="fn">on</span>(event, handler)</div>

| Event | Payload | Fires when |
|---|---|---|
| `'read'` | `{ angle }` | A poll result arrives. |
| `'write'` | `{ angle }` | A write is issued. |
| `'attached'` | `{ attached }` | Attach state changes. |
| `'done'` | `{ angle }` | A timed move reaches its target. |

Shorthand: `onRead(fn)`, `onWrite(fn)`, `onAttached(fn)`, `onDone(fn)`.

## setThrottle() / setThreshold()

Rate-limits outgoing writes — useful when driving the servo from mouse movement or a draw loop.

<div class="sig">arduino.pan.<span class="fn">setThrottle</span>(ms) · arduino.pan.<span class="fn">setThreshold</span>(degrees)</div>

| Parameter | Type | Description |
|---|---|---|
| `ms` | number | Minimum ms between writes (default `20`). |
| `degrees` | number | Minimum change in degrees to send (default `1`). |

## Properties and state

| Property | Description |
|---|---|
| `arduino.pan.angle` | Locally cached snapshot, updated on every `write()`. |

<div class="sig">arduino.pan.<span class="fn">getState</span>()</div>

**Returns** a snapshot of all servo state.

See also: [Groups](groups.html) · [Bus servo](bus-servo.html) · [Servo example](../examples/servo-example.html)
