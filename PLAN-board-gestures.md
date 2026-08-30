# PLAN — sketch-callable gesture() + group gesture (Arduino ↔ JS parity)

**Status:** CORE IMPLEMENTED (2026-08-29..30), stub-compiled, unbench-tested.
Firmware-only; JS surface unchanged. Done: `internal/gesture.h` (PardaloteSeg,
gesture-starter + immediate-writer registries, INSTALL_GESTURE/INSTALL_WRITER,
PardaloteGesture + PardaloteWrite builders, PardaloteGestureDone), registry storage
in `extensions.cpp`, `Pardalote.gesture()/write()/writeTimed()` factories, and
per-actuator `gesture()` + `onGestureDone()` + `startGesture()` + `writeNow()` +
INSTALL_GESTURE/INSTALL_WRITER on servo, stepper, bus servo. Example
`examples/board-gestures/`. Durable stub-compile harness `tools/stub-compile/` —
ALL CLEAN on ESP32/R4-WiFi/Minima. Byte-equivalence check DONE (below).
Symmetric-visibility DONE (Tier B, below). **Docs + CHANGELOG DONE** (2026-08-30):
`extensions.md` §Board-authored gestures; `gesture.md` §From the sketch + wire note;
`protocol.md` GESTURE_STATE; `isGesturing`/`gesturestart`/`gestureend` on
servo/stepper/bus-servo pages; README sketch section; CHANGELOG [Unreleased];
**protocol MINOR 0→1** in defs.h (additive, JS only errors on MAJOR); docs rebuilt
(build_reference.py + build_llms.py). **ONLY LEFT: hardware bench.**
**Delete this file once fully executed** (per repo convention — the listen-and-switch
precedent).

## write() / writeTimed() parity (added 2026-08-30, Scott's "do (a)")

Full parity with the new JS `arduino.write()` / `arduino.writeTimed()` (see the
`arduino.gesture/write/writeTimed` PROJECT-STATUS entry): `Pardalote.write()` and
`Pardalote.writeTimed(dur)` return a `PardaloteWrite` builder (`.add(deviceType,
id, target).play()`). **writeTimed reuses the gesture starter** — a timed write is
a ONE-segment linear absolute gesture per lane, so each type gets its native timed
move and lanes arrive together, zero duplicated timing code. **write (immediate)**
uses a small **ImmediateWriter registry** (parallel to the gesture-starter one):
each actuator's `writeNow(id, target)` mirrors its CMD_*_WRITE handler — servo
`_servos.write`+echoAngle, stepper moveTo+echoTarget (cancelHoming/cancelEased), bus
writePos(2400,50)+beginAwaitDone+echoTarget. **Fidelity note:** bus lanes are
written individually, NOT coalesced into one SyncWrite (same as the gesture builder)
— on-board they're µs apart so still effectively coordinated; true SyncWrite batching
deferred.

## Goal / philosophy

Pardalote's rule is **"whoever speaks is in control"** — the two sides are peers,
not author-and-remote. JS can `analogWrite()`; the board can `analogWrite()`. JS
can compose-and-play a gesture; **the board must be able to compose-and-play the
same gesture.** The board needs it so it can run **without JS**; JS keeps it so it
can run **without a sketch**. This plan adds the Arduino half to reach parity —
**nothing about the JS API changes.**

## Parity target (the JS surface we're mirroring)

Each JS actuator already exposes, and we mirror on the Arduino Access classes:

| JS (unchanged)                                  | Arduino (new)                                                        |
|-------------------------------------------------|---------------------------------------------------------------------|
| `pan.gesture([{by/to,dur,curve}], opts)`        | `PardaloteServo.gesture(id, segs, count, flags)`                    |
| `lift.gesture([...])` (stepper)                 | `PardaloteStepper.gesture(id, segs, count, flags)`                  |
| `grip.gesture([...])` (bus servo)               | `PardaloteBusServo.gesture(id, segs, count, flags)`                 |
| `group.gesture({name:[...] , ...}, opts)`       | `Pardalote.gesture().add(dev,id,segs,count,abs).play()` (builder)   |
| `await x.gesture(...).whenDone()`               | `PardaloteServo.onGestureDone(id, cb)` (completion callback)        |

Units are each actuator's native units (servo = degrees, stepper = steps, bus =
counts) — exactly like `write`/`moveTo`/`write` already are.

## Shared types (new — `internal/gesture.h`, included by `Pardalote.h`)

```cpp
// Public, sketch-authored segment. Same field layout as each Ext's private Seg,
// so startGesture() copies field-by-field (as handle() already does off the wire).
struct PardaloteSeg {
    uint8_t  curve;   // CURVE_LINEAR / CURVE_EASE_IN / _OUT / _IN_OUT / CURVE_BACK (defs.h)
    uint16_t dur;     // ms
    int32_t  value;   // absolute target (default) OR relative delta if !GESTURE_FLAG_ABSOLUTE
};
```

Reference frame defaults to **absolute** (`GESTURE_FLAG_ABSOLUTE`) — least
surprising for a C++ author writing `value = 120` meaning "120°". Pass flags `0`
for relative. (JS infers abs/rel from `to`/`by`; C++ has no such sugar, so it's an
explicit default.) Because Pardalote is **32-bit only** (ESP32 / UNO R4), a
`static const PardaloteSeg[]` lives in flash and is read directly — no PROGMEM /
pgm_read. Canned gestures cost ~0 RAM.

## Per-actuator primitive

Refactor each `handle()` gesture branch's inner block into a reusable static
helper, then call it from BOTH the wire path and the new Access method:

```cpp
// ServoExt (mirrors existing handle() CMD_SERVO_GESTURE inner block):
static void startGesture(int id, const PardaloteSeg* segs, uint8_t count,
                         uint8_t flags, uint32_t startMs, uint32_t padToMs = 0);
```

Body: clamp count→MAX_*_SEGMENTS, copy segs→`_segs[id]`, set `_segCount`/
`_segFlags`, **append a trailing hold segment** if `padToMs > sum(dur)` (see
group padding), then `loadSegment(id, 0, startMs)`. The wire handler becomes:
per block, `startGesture(sid, (PardaloteSeg*)…, count, flags, now)` — but it
already has raw bytes, so it keeps its own unpack and just calls the *load*; the
Access method is the one that goes through `startGesture(PardaloteSeg*)`. (Net: one
shared "fill + pad + load" core; two thin front-ends.)

Access method:
```cpp
void gesture(int id, const PardaloteSeg* segs, uint8_t count,
             uint8_t flags = GESTURE_FLAG_ABSOLUTE) const {
    ServoExt::startGesture(id, segs, count, flags, millis());
}
```

Bus-servo differs: arrival-clocked, `loadBusSegment(id, idx)` takes no `startMs`
(advances on the Moving-flag settle, not a timer). Its `startGesture` ignores
`startMs`; padding = a trailing hold (re-write last target, dur = padMs). The
curve byte is stored but not rendered intra-segment (existing parked caveat).

## Group / coordinated gesture (the `group.gesture()` analog)

JS `group.gesture()` does two things a naive per-actuator loop doesn't
([core.js:2431-2456]): **trailing-hold padding** so uneven lanes arrive together,
and **one phase-locked start**. On the board the start is *naturally* tighter than
JS (all channels load under one `millis()`, zero wire latency between them), so the
only real work is **cross-lane padding to a shared maxTotal**.

Decoupled, opt-in builder (no compile-time dependency on the Ext classes — matches
the self-registration philosophy of `INSTALL_EXTENSION`):

```cpp
Pardalote.gesture()
    .add(DEVICE_SERVO,   shoulder, shoulderG, 2)     // absolute by default
    .add(DEVICE_SERVO,   wrist,    wristG,    1)
    .add(DEVICE_STEPPER, lift,     liftG,     3)
    .play();                                          // pads all lanes → maxTotal, one now
```

- `add(deviceType, id, segs, count, absolute=true)` stores a lane
  `{deviceType, id, segs, count, flags, total=sum(dur)}`.
- `play()` computes `maxTotal = max(lane.total)`, captures one `now = millis()`,
  then for each lane looks up the **registered starter** for its `deviceType` and
  calls `starter(id, segs, count, flags, now, maxTotal)`.
- **Registration seam:** a tiny table `{deviceType, StarterFn}` + `INSTALL_GESTURE(
  deviceType, ServoExt::startGesture)` in each gesture-capable extension. Non-gesture
  extensions (imu/neopixel/…) don't register; only included extensions appear. Same
  pattern as the existing extension self-registration.
- `DEVICE_SERVO`/`DEVICE_STEPPER`/`DEVICE_BUSSERVO` are already public constants.

Cross-type note: bus-servo lanes are arrival-clocked, so cross-type "arrive
together" is **approximate** for them (already true of the JS group). Documented,
not fixed here.

## Completion hook (`whenDone()` analog)

`finishGesture()` (servo, [PardaloteServo.h:105]) / the stepper + bus equivalents
are the single completion points and already broadcast DONE. Add a per-actuator
sketch callback fired there:

```cpp
PardaloteServo.onGestureDone(id, [](int id){ /* advance state machine */ });
```

Plain fn-pointer `void(*)(int)` (matches the message-channel callback style —
no std::function). This is what lets a headless sketch **sequence** gestures
(jump → land → idle) with no JS. Store `_onDone[MAX_*]`, call in finish, clear
after firing? — No: keep it registered (re-armed each gesture), fire on each
completion. A `nullptr` slot = no callback (zero cost).

## Symmetric visibility (existence, never structure) — DONE 2026-08-30 (Tier B)

Implemented. New wire commands **`CMD_SERVO/STEPPER/BUSSERVO_GESTURE_STATE` (0x64/
0x65/0x66)**, Ar→JS `[id, active]`. The board broadcasts on the **_segCount 0<->positive
edge** — detected once per `loop()` per actuator, so it fires for gestures authored by
JS OR the sketch, and on ALL end paths: natural completion, AND a superseding write that
cancels the gesture with no DONE (the reason edge-detection beats broadcasting at each
cancel site). `announce()` replays active=1 for any mid-gesture actuator so a
reconnecting browser shows "gesturing". **Existence only — never the segment list.**
JS: each actuator gains `isGesturing` + `gesturestart`/`gestureend` events
(`onGestureStart/End`); dispatch mirrors the DONE case; frame-name map updated; bundle
rebuilt (`build_pardalote.py`). Chose **Tier B (flag only)**, not C (no remainingMs/
finalTarget) — existence is enough for "show busy / disable conflicting UI"; a
reconnecting browser gets live position from the existing poll stream.

- **Verified:** firmware stub-compiles clean on all 3 boards; a Node test on the REAL
  rebuilt bundle drives all three actuators' `handleMessage` — isGesturing flips, events
  fire once, duplicate active=1 is idempotent (18/18).
- **Nuance (documented):** a coordinated `Pardalote.writeTimed()` (a 1-seg gesture) sets
  isGesturing; a single-actuator native `writeTimed` (CMD_*_WRITE_TIMED, _segCount stays
  0) does not. "isGesturing" means "a board segment-schedule is playing."
- **Deferred:** Tier C envelope (remainingMs/finalTarget) if a progress-bar/destination
  UI ever wants it; true bus SyncWrite batching (unrelated).

## Control race — already correct, verify only

"Whoever speaks is in control" is already implemented: an immediate `write`/`stop`
cancels a running gesture via `_segCount = 0`, and the check is **origin-agnostic**
([PardaloteServo.h:362]). A board write interrupting a JS gesture and vice-versa
already resolve last-speaker-wins. No new policy; just confirm on the bench.

## File-by-file

1. `internal/gesture.h` (new) — `PardaloteSeg`, starter registry + `INSTALL_GESTURE`,
   `PardaloteGesture` builder + `Pardalote.gesture()` factory. Included by `Pardalote.h`.
2. `PardaloteServo.h` — `startGesture()`, refactor handle branch to share the load,
   Access `gesture()`, `onGestureDone()`, `_onDone[]`, `INSTALL_GESTURE`.
3. `PardaloteStepper.h` — same (time-clocked, `loadStepperSegment`).
4. `PardaloteBusServo.h` — same (arrival-clocked, `loadBusSegment`, no startMs).
5. `Pardalote.h` — include `gesture.h`; expose `Pardalote.gesture()` if the builder
   isn't a free factory.
6. Docs: `docs-src/reference/*.md` (gesture pages gain the Arduino side), README,
   CHANGELOG. New IDE example: a headless board-gesture sketch (sensor → gesture,
   sequenced via onGestureDone). Rebuild via both build scripts.

## Verification (no hardware — standing caveat)

- DONE — Stub `-fsyntax-only` compile on ESP32 + UNO R4 WiFi + Minima. Built a
  durable harness at `tools/stub-compile/` (run `run.sh`; the /tmp matrix from the
  serial-transport work was ephemeral and gone). All six TUs — the sketch-shaped
  `main_motion.cpp` (exercises gesture()/onGestureDone/Pardalote.gesture()) plus
  Pardalote.cpp, extensions.cpp, serial_transport.cpp, led_matrix.cpp,
  wifi_config.cpp — parse clean on all three boards. Negative-tested: wrong-arity
  gesture()/add() calls are rejected, so the API is really type-checked.
- DONE — byte-equivalence check (`tools/stub-compile/gesture_equiv_test.cpp`, build+run
  with g++). Replicates both paths' exact field logic (JS `_gestureBlock` encode → wire
  unpack vs board `startGesture`, then `loadSegment`'s played target). **PASS: 0
  played-target mismatches** across in-range / out-of-range(±) / soft-limit / relative /
  zero-dur / extremes. Finding: `_segs.value` *storage* differs only for out-of-range
  ABSOLUTE targets (JS pre-clamps at encode; board stores raw + lets `loadSegment` clamp)
  — motion identical because `loadSegment` is the single clamp authority. By-design (clamp
  once), not a defect; in-range/relative/zero-dur bytes match exactly.
- Bench TODO (BENCH-TESTS.md): board-authored single + group gesture on real servos/
  stepper/bus; onGestureDone sequencing; JS-write-cancels-board-gesture and vice-versa.

## Open decisions (carried into implementation)

1. Reference-frame default: **absolute** (chosen). Relative via `flags = 0`.
2. Scalars (durScale/amp/repeat) — NOT in this cut; parametric = "write a function
   that emits segments," symmetric on both sides. Add later as shared opt if wanted.
3. Builder ergonomics: `add(deviceType, …)` (decoupled) vs typed `.servo()`
   (couples builder to Ext types). **Chosen: `add(deviceType, …)`.**
