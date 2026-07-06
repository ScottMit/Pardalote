title: Groups
lede: Drive several actuators as one — a single message moves every member, and coordinated moves arrive together.
---
A **group** is a named collection of actuators you drive together. `set()` writes every member in a **single WebSocket message**, and `moveTo()` coordinates a move so all members **arrive together**. Groups currently take **Servo**, **BusServo**, and **Stepper** members (pins and NeoPixels are planned).

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

## set()

Writes all named members at once. Every member's frame is packed into **one** WebSocket message, so the board applies them back-to-back within a single receive — they move together. Bus servos of the same series are additionally coalesced into a single hardware **SyncWrite** packet (a truly simultaneous latch).

<div class="sig">arm.<span class="fn">set</span>(targets)</div>

| Parameter | Type | Description |
|---|---|---|
| `targets` | object | Member names mapped to target values, in each member's native unit (counts, steps, degrees). |

```javascript Example — write everyone at once
arm.set({ shoulder: 2048, elbow: 3000, base: 1600, wrist: 90 });
```

## moveTo()

Moves every member to its target so they all finish after about `duration` ms. Each actuator type uses its own native mechanism:

| Member | How it arrives together |
|---|---|
| Bus servo | one SyncWrite with per-servo speeds matched to distance |
| PWM servo | on-board interpolation over the shared duration |
| Stepper | constant-speed move, the board sizing speed from its own position |

All of it still goes out in **one** batched message — including mixed groups.

<div class="sig">arm.<span class="fn">moveTo</span>(targets, { duration })</div>

| Parameter | Type | Description |
|---|---|---|
| `targets` | object | Member names mapped to target values. |
| `duration` | number | Approximate arrival time in ms. |

```javascript Example — arrive together
arm.moveTo({ shoulder: 3000, elbow: 1200, base: 0, wrist: 120 }, { duration: 1500 });
```

`duration` is approximate — it's the *arrival synchronisation* that's exact. For an accurate first move from an unknown pose, either poll `read()` first or start from a known pose (`center()` / `set()`), since `moveTo` measures distance from each member's last commanded position.

## moveToAsync()

Promise variant — resolves after `duration` (time-based, for sequencing).

<div class="sig">await arm.<span class="fn">moveToAsync</span>(targets, { duration })</div>

```javascript Example — sequence poses
await arm.moveToAsync({ shoulder: 2048, elbow: 2048 }, { duration: 1000 });
await arm.moveToAsync({ shoulder: 1000, elbow: 3000 }, { duration: 800 });
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

## stop() / getState()

<div class="sig">arm.<span class="fn">stop</span>() · arm.<span class="fn">getState</span>()</div>

`stop()` stops polling every member. `getState()` returns `{ name, members: { shoulder: {...}, base: {...}, ... } }`.

See also: [Servo](servo.html) · [Stepper](stepper.html) · [Bus servo](bus-servo.html) · [Coordinated motion example](../examples/coordinated-motion-example.html)
