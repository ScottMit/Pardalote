# PLAN — sketch-callable gesture() + group gesture (Arduino ↔ JS parity)

**Status:** CORE IMPLEMENTED (2026-08-29..30), stub-compiled, unbench-tested.
Firmware-only; JS surface unchanged. Done: `internal/gesture.h` (PardaloteSeg,
gesture-starter + immediate-writer registries, INSTALL_GESTURE/INSTALL_WRITER,
PardaloteGesture + PardaloteWrite builders, PardaloteGestureDone), registry storage
in `extensions.cpp`, `Pardalote.gesture()/write()/writeTimed()` factories, and
per-actuator `gesture()` + `onGestureDone()` + `startGesture()` + `writeNow()` +
INSTALL_GESTURE/INSTALL_WRITER on servo, stepper, bus servo. Examples
`examples/board-gestures-PWM-servos/` + `-bus-servos/` (renamed/split 2026-09-20;
both demo the scale/speed/crop shaping cycle). Durable stub-compile harness `tools/stub-compile/` —
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
   **See "Gesture manipulation (scale / speed / crop)" below** — the worked design
   for exactly this, prompted by Plan-D (2026-09-10). Direction has firmed up:
   play-time *parameters* (not a data-transform step), symmetric on both sides.
3. Builder ergonomics: `add(deviceType, …)` (decoupled) vs typed `.servo()`
   (couples builder to Ext types). **Chosen: `add(deviceType, …)`.**

## Gesture manipulation (scale / speed / crop) — parity analysis (2026-09-10)

**Status:** DESIGN ONLY, nothing built board-side. Fleshes out Open decision #2.
Prompted by **Plan-D** (the LLM robot controller): it builds gestures with an
`intensity` and wanted to also vary amplitude/tempo and play a slice. A JS-only
prototype exists there (NOT in this library yet) — see below — and the question
that drove this note was: *does board-authored gesture construction change the
approach, and should a gesture be a class with these as methods?*

### The three transforms
- **scale(k)** — amplitude: every relative delta × k (`target-from` for absolute).
  Timing/curves untouched. Keeps a relative round-trip net-zero.
- **speed(f)** — tempo: playback-rate multiplier, `dur /= f` (f=2 → twice as fast,
  0.5 → half). Amplitude/curves untouched. Keeps net-zero.
- **crop(from,to)** — play only a fractional window of the timeline. **Breaks the
  round-trip** (relative gesture no longer net-zero → ends off-home; caller must
  park/return). Needs mid-segment splitting.
- (Deliberately NOT doing `speed(curve)` / non-linear tempo warp yet.)

### Key finding: the board flips the natural implementation
JS gestures are heap arrays, so pure `lanes → lanes` transforms are free (that's
how the Plan-D prototype works). **None of that holds on the board:** gestures are
`static const PardaloteSeg[]` in **flash (read-only)**, fixed `MAX_*_SEGMENTS`
caps, no GC. "Return a new transformed gesture" would mean allocating a RAM
`PardaloteSeg` buffer and managing its size — fighting the flash-const, ~0-RAM
design.

But the board already **samples the eased curve every interpolator tick**, and
`startGesture(id, segs, count, flags, startMs, padToMs)` is already a parameter
list. So the cheap, buffer-free path is to apply the transforms **at segment
load / playback time**, as parameters — not as a data-transform step:

```cpp
struct PardaloteGestureMod {     // all defaults = identity
    float scale    = 1.0f;       // amplitude ×
    float speed    = 1.0f;       // tempo × (2 = twice as fast)
    float cropFrom = 0.0f;       // window start, fraction of total
    float cropTo   = 1.0f;       // window end
};
```
- scale → multiply the delta as each segment loads (free).
- speed → divide `dur` on load (free).
- crop → start the load loop past `cropFrom·total`, clip the boundary segments,
  stop after `cropTo·total`. **No buffer** — just where load starts/stops.
- Float is fine: the board already does float easing (`pardaloteEase`), FPU on
  R4/ESP32. No fixed-point needed.

The board **must** own crop logic regardless — board gestures run without JS, so
JS can't pre-crop for it.

### Decision: parameter-based surface, symmetric, ONE shared formula
Make the canonical API the parameters (opts/mods) applied at play time, mirrored
both sides; the chainable object is sugar over it, not a JS-only pipeline.

- JS: `gesture(lanes, { scale, speed, crop })` (+ optional chainable `Gesture`).
- C++: `PardaloteGestureMod` applied in each actuator's `loadSegment`, e.g.
  `Pardalote.gesture(pan, NOD, 3).scale(0.7).speed(0.5).play();`.

**Hazard this avoids:** crop's "how much of a clipped segment's eased travel is
inside the window" is new, subtle math. If JS crops by materializing and the board
crops at load-time, that's TWO implementations of one formula to keep in sync —
the exact `curveShape`↔`shapeCurve` drift trap. So define the crop window→segment
math **once, next to `pardaloteEase` (defs.h), mirror in JS**, apply at play/load
on both sides. The materialized JS version stays only as impl/preview derived from
that formula.

### Should a gesture be a class, with these as methods? Yes — a *lazy* handle
Not a container that materializes transformed arrays. A lightweight object holding
`{ segs*/lanes, count/flags, mods }`; methods set mods and return the object;
`.play()` / acceptance by `gesture()` applies mods at load.
- JS: immutable `Gesture` value object, but does NOT replace the plain-lanes path
  (`gesture(lanes)` still works); may also materialize for the p5 face preview.
- C++: stays lazy (pointer + count + a few float mods) → ~0 RAM, no buffer.
- **Naming wrinkle:** `PardaloteGesture` already = the multi-lane *coordinator*
  builder. Single-lane mods most naturally live on its `.add(...)` lanes or a
  chained mod on the builder; needs a deliberate ownership pass, not a second
  colliding class.

### Coordination rule (bake into both APIs)
Transforms must stay consistent across a coordinated gesture or phase-lock /
arrive-together breaks:
- **speed & crop are timing-affecting → group-global** (one factor, one window on
  the shared timeline).
- **scale is amplitude-only → MAY be per-lane** (e.g. scale just the antennas)
  without breaking coordination. Per-lane amplitude that isn't a global intensity
  is really authoring — put it in the segments.

### Plan-D JS prototype (bench-truth for the shared crop formula)
Lives in the **Plan-D** repo, not here: `app/transforms.js` (`GestureFX.scale/
speed/crop/apply/duration`, pure `lanes → lanes`, non-mutating), played via a new
`Robot.playLanes()` seam and a dev-tuning UI panel (scale/speed sliders + two-
handle crop). Crop verified to leave the expected off-home delta; `park()` after.
When promoting here: reuse its crop math as the JS side of the single shared
formula; keep its pure functions as impl/preview, expose the parameter/method
surface as public.

### Build order when picked up
1. Shared crop window→segment formula beside `pardaloteEase` (defs.h) + JS mirror.
2. `PardaloteGestureMod` applied in each actuator `loadSegment` (scale/speed/crop),
   `speed`/`crop` group-global, `scale` per-lane-allowed.
3. Chainable sugar both sides; resolve the `PardaloteGesture` naming/ownership.
4. Extend byte/played-target equivalence test (`tools/stub-compile/
   gesture_equiv_test.cpp`) to cover modded playback. Then bench.

### DONE 2026-09-20 — JS shipped + benched, board implemented + parity-verified
- **JS (shipped, bench-confirmed in Plan-D).** `scale`/`speed`/`crop` as opts on every
  `gesture()` and a lazy immutable chainable `Gesture` (`arduino.makeGesture(spec)`),
  in `pardalote-core.js`; crop reuses `curveShape` (the shared formula — no JS-side
  duplicate). Docs (`gesture.md` §Shaping, `extensions.md`, README) + CHANGELOG done,
  bundle rebuilt. Plan-D now uses the library `Gesture` (its local `transforms.js`
  deleted). **Naming decision:** kept the surface = params + a `Gesture` VALUE object
  accepted by `gesture()`; `makeGesture()` is the factory (didn't touch `group.gesture`'s
  immediate-send). scale composes (×), crop last-wins.
- **Board (implemented, stub-clean, NOT bench-tested).** Not applied per-tick in
  `loadSegment` after all — applied ONCE at gesture start over the RAM `_segs[]` copy
  each actuator already keeps (crop only shrinks → safe in-place), via a templated
  `pardaloteApplyModsInPlace<Seg>()` in `internal/gesture.h` (uses `pardaloteEase`;
  `pardaloteRound` = `floorf(x+0.5)` to match JS `Math.round` exactly, incl. negative
  halves). `PardaloteGestureMod{scale,speed,cropFrom,cropTo}` threads through the
  `GestureStarter` typedef + `startGestureFor` (extensions.cpp) + each `startGesture`
  + each Access `gesture(id,segs,count,flags,mod)`. **Naming resolved:** `speed`/`crop`
  live on the `PardaloteGesture` builder (`.scale/.speed/.crop`, group-global), per-lane
  amplitude via `add(..., laneScale)` — no new class colliding with `PardaloteGesture`.
- **Order caveat (physical-equivalence, not byte):** JS group does mod→pad; board does
  pad→mod (mod applied after the arrive-together pad). For RELATIVE gestures (the norm)
  the result is physically identical; the single-lane transform is byte-identical (below).
- **Parity verified.** New `tools/stub-compile/gesture_mods_equiv.{cpp,js}` runs the REAL
  board `pardaloteApplyModsInPlace` vs the REAL JS `applyGestureModsLane` on 7 cases
  (scale/speed/crop/combo/absolute) → **byte-identical**; wired into `run.sh` (all 3
  boards compile clean too). **Only left: hardware bench** of board-authored modded
  gestures (single + coordinated builder).
