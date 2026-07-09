title: Groups
lede: Drive several actuators as one — a single message moves every member, and coordinated moves arrive together.
---
A **group** is a named collection of actuators you drive together, with methods that mirror the single actuators. `write()` writes every member in a **single WebSocket message**, `writeTimed()` coordinates a move so all members **arrive together**, and `whenDone()` awaits real completion. Groups currently take **Servo**, **BusServo**, and **Stepper** members (pins and NeoPixels are planned).

## arduino.group()

Creates a group from named members. Call inside `on('ready')`, after attaching each member.

<div class="sig">arduino.<span class="fn">group</span>(name, members)</div>

| Parameter | Type | Description |
|---|---|---|
| `name` | string | The group's name. The group also becomes available as `arduino[name]`. |
| `members` | object | Map of member names to extension instances. |

**Returns** the group object.

```javascript Example — build an arm group
arduino.add('shoulder', new BusServo());
arduino.add('elbow',    new BusServo());
arduino.add('base',     new Stepper());
arduino.add('wrist',    new Servo());

arduino.on('ready', () => {
    // ... attach each member ...
    const arm = arduino.group('arm', {
        shoulder: arduino.shoulder,
        elbow:    arduino.elbow,
        base:     arduino.base,
        wrist:    arduino.wrist,
    });
});
```

## write()

Writes all named members at once — the group counterpart of `servo.write()` / `stepper.moveTo()`. Every member's frame is packed into **one** WebSocket message, so the board applies them back-to-back within a single receive — they move together. Bus servos of the same series are additionally coalesced into a single hardware **SyncWrite** packet (a truly simultaneous latch).

<div class="sig">arm.<span class="fn">write</span>(targets)</div>

| Parameter | Type | Description |
|---|---|---|
| `targets` | object | Member names mapped to target values, in each member's native unit (counts, steps, degrees). |

```javascript Example — write everyone at once
arm.write({ shoulder: 2048, elbow: 3000, base: 1600, wrist: 90 });
```

## writeTimed()

Moves every member to its target so they all finish after about `duration` ms — the same shape as a single actuator's `writeTimed(value, duration)`. Each actuator type uses its own native mechanism:

| Member | How it arrives together |
|---|---|
| Bus servo | one SyncWrite with per-servo speeds matched to distance |
| PWM servo | on-board interpolation over the shared duration |
| Stepper | constant-speed move, the board sizing speed from its own position |

All of it still goes out in **one** batched message — including mixed groups.

<div class="sig">arm.<span class="fn">writeTimed</span>(targets, duration)</div>

| Parameter | Type | Description |
|---|---|---|
| `targets` | object | Member names mapped to target values. |
| `duration` | number | Approximate arrival time in ms (default 1000). |

```javascript Example — arrive together
arm.writeTimed({ shoulder: 3000, elbow: 1200, base: 0, wrist: 120 }, 1500);
```

`duration` is approximate — it's the *arrival synchronisation* that's exact. For an accurate first move from an unknown pose, either poll `read()` first or start from a known pose (`center()` / `write()`), since `writeTimed` measures distance from each member's last commanded position.

## whenDone()

Promise for the group's most recent `write()`/`writeTimed()`. Resolves `true` when **every** moved member reports it actually **arrived** (each actuator's real `done` — feedback-confirmed, not a timer), or `false` on the safety timeout if a member never reports (dead servo, lost link). The same method exists on every single actuator.

<div class="sig">await arm.<span class="fn">whenDone</span>([{ timeout }])</div>

| Parameter | Type | Description |
|---|---|---|
| `timeout` | number | Safety timeout in ms (default `max(duration × 2, 10000)`; `0` waits forever). A bare number also works: `whenDone(5000)`. |

```javascript Example — sequence poses
await arm.writeTimed({ shoulder: 2048, elbow: 2048 }, 1000).whenDone();
await arm.writeTimed({ shoulder: 1000, elbow: 3000 },  800).whenDone();
```

## read() / values()

Polling and snapshots across every member.

<div class="sig">arm.<span class="fn">read</span>([interval]) · arm.<span class="fn">values</span>()</div>

| Call | Effect |
|---|---|
| `arm.read(100)` | Start polling every member at 100 ms. |
| `arm.read()` | Snapshot of cached values → `{ shoulder, elbow, base, wrist }`. |
| `arm.read(END)` | Stop polling every member. |
| `arm.values()` | Same snapshot, no polling change. |

## home()

Sends every member to its stored home — servos and bus servos as (optionally timed) moves, steppers via their limit-switch homing routine (a routine has no duration). Not arrive-together: each member homes at its own pace. `whenDone()` resolves when every member settles; homing can be slow, so raise the timeout.

<div class="sig">arm.<span class="fn">home</span>([duration])</div>

```javascript Example — everything to home pose
await arm.home(1500).whenDone({ timeout: 30000 });
```

## stop() / getState()

<div class="sig">arm.<span class="fn">stop</span>() · arm.<span class="fn">getState</span>()</div>

`stop()` halts every member's motion — the group counterpart of `member.stop()` (to stop polling, use `read(END)`). `getState()` returns `{ name, members: { shoulder: {...}, base: {...}, ... } }`.

See also: [Servo](servo.html) · [Stepper](stepper.html) · [Bus servo](bus-servo.html) · [Coordinated motion example](../examples/coordinated-motion-example.html)
