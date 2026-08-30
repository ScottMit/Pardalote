title: Gesture
lede: Author a timed motion — a segment schedule the board runs on its own clock. One channel, or many together in a single message.
---
A **gesture** is a **segment schedule**: a list of timed moves — each a target, a duration, and an easing curve — that the board plays on its **own clock** after one message. You send it once; the board sequences the segments locally and fires a real `done` when the last one finishes. Author it for **one** actuator with its own `gesture()`, or for **many at once** with `arduino.gesture()` — same segment format either way.

## Segments

Every gesture is an array of segments. Each segment is one leg of the motion:

| Field | Type | Description |
|---|---|---|
| `to` / `by` | number | Absolute target (`to`) or relative delta (`by`), in the actuator's native unit — servo counts, stepper steps, or degrees. |
| `dur` | number | Segment duration in ms. This **sizes the move's speed**; if the authored duration is faster than the actuator can go, the segment simply takes longer and the next still fires on true arrival. |
| `curve` | string | Easing shape: `linear`, `easeIn`, `easeOut`, `easeInOut`, or `back` (a slight overshoot). |

A gesture is **relative** by default — each `by` segment chains from wherever the actuator is when it starts, so the same gesture replays from any pose. Use `to` for absolute targets, or force it for a whole gesture with `{ absolute: true }`. Absolute targets are clamped to the actuator's [soft limits](bus-servo.html#setlimits--clearlimits).

## One actuator — `gesture()`

Play a schedule on a single actuator. The segment shape and any on-hardware notes are per actuator — see [servo](servo.html#gesture), [bus servo](bus-servo.html#gesture), and [stepper](stepper.html#gesture).

<div class="sig">servo.<span class="fn">gesture</span>(segments, [opts])</div>

```javascript Example — one actuator
grip.gesture([
    { by:  600, dur: 400, curve: 'easeOut'   },
    { by: -600, dur: 600, curve: 'easeInOut' },
]);
await grip.gesture([ /* … */ ]).whenDone();
```

## Many at once — `arduino.gesture()`

Play a **multi-channel** gesture in **one batched message** — every channel starts together, and shorter lanes are padded with a trailing hold so they all **arrive together**. Lanes are per-channel, so overlapping timings give coordination and follow-through. This is the expressive counterpart of [`writeTimed()`](groups.html#writetimed), and the multi-actuator counterpart of a single `gesture()`.

<div class="sig">arduino.<span class="fn">gesture</span>(lanes, [opts])</div>

| Parameter | Type | Description |
|---|---|---|
| `lanes` | object | Actuator names (the names you passed to [`add()`](extensions.html)) mapped to segment arrays — each the same shape a single actuator's `gesture()` takes. |
| `opts` | object | Optional. `{ absolute }` forces the reference frame for **all** lanes. |

It runs through a **transient, anonymous group** — nothing is stored on the `arduino` — and **returns that group**, so `whenDone()` and `stop()` chain. A lane naming an actuator that doesn't support `gesture()`, an unknown name, or an empty array is skipped with a warning; the rest still play. **Mixed types work**: servos, steppers, and bus servos in one call each play via their own on-board mechanism, all coordinated on the board clock.

```javascript Example — a coordinated reach with follow-through
arduino.add('shoulder', new BusServo());
arduino.add('wrist',    new Servo());
const { shoulder, wrist } = arduino;

arduino.on('ready', () => {
    shoulder.attach(1, 'ST');
    wrist.attach(9);

    arduino.gesture({
        shoulder: [{ by: 300, dur: 400, curve: 'easeOut'   },
                   { by:-300, dur: 600, curve: 'easeInOut' }],   // 1000 ms
        wrist:    [{ to: 120, dur: 250, curve: 'back'       }],   // 250 ms → padded to 1000
    });
});
await arduino.gesture({ /* … */ }).whenDone();
```

For a **single** actuator, prefer its own `gesture([ … ])` — there's nothing to coordinate.

## On a held group — `group.gesture()`

If you're already holding a [group](groups.html) to drive a set of actuators live — `write()`, `writeTimed()`, `read()`, `stop()` — then [`group.gesture(lanes)`](groups.html#gesture) does exactly the same thing on its members. Reach for `arduino.gesture()` when you just want to fire a gesture once; reach for a named group when you also need the live-control methods on the same set.

## Awaiting completion — `whenDone()`

Every form returns something you can await. `whenDone()` resolves `true` when **every** channel reports it actually **arrived** (each actuator's feedback-confirmed `done`, not a timer), or `false` on a safety timeout if a channel never reports (dead servo, lost link).

<div class="sig">await arduino.gesture({ … }).<span class="fn">whenDone</span>([{ timeout }])</div>

```javascript Example — play, then continue
await arduino.gesture({ shoulder: reachSegs, wrist: flickSegs }).whenDone();
console.log('pose reached');
```

## From the sketch — the board authors gestures too

Gestures aren't only a browser thing. Because a gesture plays entirely **on the board**, the **sketch** can compose and fire one with no browser present — the same segment model, the same on-board player. `PardaloteServo.gesture(id, segs, count)` plays one actuator; `Pardalote.gesture().add(…).play()` coordinates several; `onGestureDone(id, cb)` chains one into the next for a headless sequence. A board-authored gesture broadcasts its **existence** to connected browsers — each sees the actuator's `isGesturing` flag and a `gesturestart` / `gestureend` event — so a browser can show "busy" without ever receiving the schedule. See [Board-authored gestures](extensions.html#board-authored-gestures).

## Under the hood

On the wire a gesture is already **multi-channel**: one `CMD_*_GESTURE` frame carries a block per channel, and the board runs each block on its own clock. `arduino.gesture()` and `group.gesture()` produce byte-identical frames — "group" is purely a JavaScript convenience for coordinating and naming a set. A running gesture also broadcasts a lightweight `CMD_*_GESTURE_STATE [id, active]` (existence, never the schedule), which drives the `isGesturing` flag and is replayed on reconnect. See the [Protocol](protocol.html) page for the frame layout.

See also: [Servo](servo.html) · [Bus servo](bus-servo.html) · [Stepper](stepper.html) · [Groups](groups.html) · [Coordinated motion example](../examples/coordinated-motion.html)
