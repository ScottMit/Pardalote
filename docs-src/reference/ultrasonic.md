title: Ultrasonic
lede: Up to 4 HC-SR04-style distance sensors, in 3-wire or 4-wire configurations, with polled reads in centimetres or inches.
---
Requires `<PardaloteUltrasonic.h>` in the sketch. No third-party library needed. Examples assume:

```javascript
arduino.add('sonar', new Ultrasonic());
```

## attach()

Attaches the sensor. Call inside `on('ready')`.

<div class="sig">arduino.sonar.<span class="fn">attach</span>(trig, [echo])</div>

| Parameter | Type | Description |
|---|---|---|
| `trig` | number \| string | Trigger pin. For 3-wire sensors this is also the echo pin. |
| `echo` | number \| string | Optional. Echo pin (4-wire sensors). |

```javascript Example — 3-wire and 4-wire
arduino.sonar.attach(7, 8);  // 4-wire: trig 7, echo 8
arduino.sonar.attach(6);     // 3-wire: trig and echo on one pin
```

## detach()

Releases the pins.

<div class="sig">arduino.sonar.<span class="fn">detach</span>()</div>

## setTimeout()

How long the Arduino waits for an echo before giving up. Maximum range follows from it: 30 ms ≈ 500 cm.

<div class="sig">arduino.sonar.<span class="fn">setTimeout</span>(ms)</div>

| Parameter | Type | Description |
|---|---|---|
| `ms` | number | Echo timeout in ms. Default `30`. |

## read()

Reads the distance. Same poll-and-cache pattern as `analogRead()`: the first call starts a poll, later calls return the cached value — safe to call every frame.

<div class="sig">arduino.sonar.<span class="fn">read</span>([interval], [unit])</div>

| Parameter | Type | Description |
|---|---|---|
| `interval` | number | Optional. Poll interval in ms. Pass `END` to stop. |
| `unit` | constant | Optional. `CM` or `INCH` — applies to all subsequent reads. |

**Returns** the cached distance, or `-1` if the echo timed out (nothing in range).

```javascript Example — distance in a draw loop
arduino.sonar.read(200, CM);   // start polling every 200 ms, in cm

function draw() {
    let cm = arduino.sonar.read();          // cached — no extra traffic
    if (cm === -1) { /* out of range */ }
}
```

Point the sensor at flat, hard surfaces — fabric and foam absorb ultrasound and can read as "nothing there".

## Events

<div class="sig">arduino.sonar.<span class="fn">on</span>(event, handler)</div>

| Event | Payload | Fires when |
|---|---|---|
| `'read'` | `{ distance, unit }` | A poll result arrives. `unit` is `CM` or `INCH`. |

Shorthand: `onRead(fn)`.

## Properties and state

| Property | Description |
|---|---|
| `arduino.sonar.distance` | Last reading. |

<div class="sig">arduino.sonar.<span class="fn">getState</span>()</div>

**Returns** `{ trigPin, echoPin, attached, timeoutMs, distance, unit, interval }`.

See also: [Ultrasonic example](../examples/ultrasonic-sensor-example.html) · [Troubleshooting](troubleshooting.html)
