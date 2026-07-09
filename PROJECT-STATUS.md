# Pardalote — project status & handoff

Working notes for continuing development. Pardalote is a browser-JS ⇄ Arduino
library: the browser talks to the board over a WebSocket (custom binary
protocol); the board runs the user's sketch plus opt-in extensions. Goal: let
design students drive real hardware (servos, steppers, bus servos, LEDs, …)
from p5.js with zero toolchain, eventually with LLM control.

> **Read this first, then read the [README](README.md).** The README documents
> the *public API*; this file captures *state, rationale, and what's left* —
> the stuff that isn't obvious from the code.

---

## ⚠️ Standing caveat: the Arduino code is bench-tested only in parts

The dev environment still has **no Arduino toolchain and no physical actuators**,
so newly written code is **structurally verified only** (brace/wire-format checks,
careful review; JS verified in-browser against the real wire frames). **But a first
hardware bench test happened 2026-07 on an ESP32-WROVER** (Scott's rig), and a large
slice of the core + actuator path is now confirmed on real hardware.

### ✅ Confirmed on hardware (2026-07, ESP32-WROVER)
- **Core transport** — WiFi connect, HELLO handshake (ADC range), `ready`, silent
  auto-reconnect, multi-client sync.
- **Pins** — `digitalWrite`, shared buttons (`share`/`send`), analog input
  (`share(A0, MODE_ANALOG_INPUT)` auto-poll). *(ESP32 gotcha found: analog input must
  be on an ADC1 pin — ADC2 is disabled while WiFi is up, reads 0.)*
- **Messaging channel** — `watch`/`onMessage` both ways, typed values, `retain` replay
  to a late browser, `broadcast` to a second browser (+ sketch), frame monitor.
- **PWM servo** — attach, `write`, `writeTimed`+`whenDone`, soft-limit clamp, setHome/home.
- **Sketch-created servo** — all four materialisation cases (late browser, mid-loop
  attach, reconnect-after-reset, idempotent re-attach).
- **Stepper** — attach (STEP/DIR + FULL4WIRE), moveTo/move/moveToTimed, runSpeed,
  read/position, enable/disable, soft limits, `setPosition`.
- **Stepper limit switches** — board-side trip, direction-aware guard, release debounce,
  `'limit'` event.
- **Stepper homing** — full SEEK→BACKOFF→TRAVEL, re-zero at trip, `home({speed,timeout})`,
  `homeFail` on timeout, and the instant-kill across POSITION/VELOCITY/TIMED (Phase 7.6).

### 🔧 Fixed + bench-verified this session (stepper firmware)
- **`hardStop()` — new distinct verb** (`CMD_STEPPER_HARD_STOP 0x57`): instant halt, no
  decel ramp, keeps the coordinate, DONE follows. JS `Stepper.hardStop()` + sketch
  `PardaloteStepper.hardStop(id)`. Chosen over a `stop({hard})` flag.
- **Velocity-`stop()` no longer runs away.** Stopping a `runSpeed`/timed spin used to
  *re-accelerate* — `AccelStepper::stop()`+`run()` planned a fresh move from rest because
  the accel-ramp state (`_n`) is stale after `setSpeed()`. New **`MODE_STOPPING`** ramps
  `setSpeed()` down at the configured accel to a clean halt; POSITION-mode stops still use
  `AccelStepper::stop()` (correct there).
- **Velocity soft-limit overshoot fixed** — hitting a soft limit under `runSpeed` no longer
  steps one past then snaps back (skip the step on the clamp tick).

**Still unverified on hardware** — bus servos (all — deferred), SC-series, sketch-created
stepper/busservo/NeoPixel/Ultrasonic/MPU, the UNO R4 path, and the camera. Details:

**Still to confirm on real hardware** (items above are done; these remain):
- **Stepper homing** (newest, zero bench time): the SEEK→BACKOFF→TRAVEL
  sequence end-to-end — seek trips cleanly, counter adopts the switch
  coordinate, back-off actually releases the switch (if the release point
  drifts past the trip point, BACKOFF may need extra travel), and the
  final DONE lands. Also that `setSpeed()` survives the maxSpeed
  restore between legs, and homing from an already-pressed switch.
- **Stepper limit switches** (zero bench time): trip latency inside
  `loop()` under WiFi load, the direction-aware guard (`speed()` sign with
  `distanceToGo` fallback — confirm no trip when backing off a pressed
  switch), the 20 ms release debounce on real mechanical switches, and that
  `setCurrentPosition(currentPosition())` behaves as an instant kill in all
  three modes (POSITION / VELOCITY / TIMED).
- **SCServo library method names**, especially `ReadMove` on the **`SCSCL` (SC)
  class** — least certain. Also `WritePosEx`, `SyncWritePosEx`, `CalibrationOfs`,
  `unLockEprom`/`writeByte`, and the ID register constants (`SMS_STS_ID` /
  `SCSCL_ID`). The **ST/STS3215 path is the primary one**; SC is coded but least sure.
- **AccelStepper**: `runSpeedToPosition()` for timed moves, and that `setSpeed()`
  is clamped to `maxSpeed()` (the timed-move code raises the cap, then restores it).
- **Servo interpolator**: the 20 ms tick feel under WiFi load.
- **Bus-servo `done`**: the board polls the `Moving` flag (~30 Hz); confirm no
  false `done` at t=0 (there's a 40 ms startup guard) and that long moves aren't
  cut short (no-response watchdog, not a fixed timeout).
- **Sketch-created servos** (zero bench time): the JS
  side is well tested (including against real firmware announce bytes,
  host-compiled), but confirm on hardware: `PardaloteServo.attach("pan",
  9)` in `setup()` → browser connects later → `arduino.pan` exists at
  `'ready'` with correct pin/angle; a browser already connected when the
  sketch attaches (mid-loop attach) gets it live; reconnect after board
  reset re-materialises it; and the UNO R4 path compiles (host
  stub-compile covered ESP32 defines only).
- **Sketch-created steppers & bus servos** (newest, zero bench time):
  same materialisation path as sketch-created servos, extended to the
  other two actuators (`PardaloteStepper.attach("base", 2, 3, 4)` /
  `attach4wire`, `PardaloteBusServo.attach("wrist", 5)`). Confirm the
  same four cases (mid-loop attach live, late-browser announce replay,
  reconnect after reset, idempotent re-attach by name), plus that the
  bus-servo attach brings the shared UART up correctly and its return
  value (the logical id) feeds `write`/`read` as expected.
  Stub-compile covered the ESP32 path only — confirm UNO R4 compiles.
- **Sketch-created NeoPixel / Ultrasonic / MPU** (newest, zero bench
  time): same four materialisation cases as above. Plus per device:
  NeoPixel `attach`+`fill/show` drives the strip and a late browser sees
  current colours via announce; Ultrasonic `read()` returns cm and the
  browser poll still works alongside sketch reads; MPU `attach("imu",
  "6050")` identifies on the bus (WHO_AM_I), `read()` returns sane
  accel/gyro, and the model-payload attach round-trips to the browser.
  Stub-compile covered the ESP32 path only.
- **Message channel** (newest, zero bench time; JS verified in Node — codec
  round-trip for all six types + full runtime path incl. watch/`on('message')`/
  cache/monitor, and firmware stub-compiled clean): confirm on real hardware —
  browser→sketch `watch`/`onMessage` fire with the right type; sketch→browser
  `send` reaches every client; **`retain`** replays to a late-connecting browser
  in the pre-`ready` sync (and survives text/blob within the 48 B cap, warns+skips
  beyond); **`broadcast`** relays a browser message to a *second* browser but not
  back to the sender, and the sketch still sees it; a text/blob near the ~240 B
  Arduino→JS cap; and the frame monitor (`onFrame` / `on('frame')`) sees real
  device traffic decoded (`SERVO_WRITE`, etc.) with no perf hit under WiFi load.

---

## What's built this session

> **Note:** the bullets below marked "(this session)" are from earlier
> sessions; the **Stepper homing rework** entry immediately following is the
> current session's work (the **Message channel** entry beneath it was the
> prior session's). (The heading predates the multi-session history.)

- **Stepper homing rework — home is the origin (current session)**
  (`PardaloteStepper.h` + `stepper.js`, `internal/defs.h`, `frame_names.h`).
  Flipped the homing coordinate model. **Home is now the origin (`0`)** and each
  limit switch carries its own coordinate, **independent of the soft limits**.
  New command `CMD_STEPPER_SET_SWITCH_POS 0x54` + `setSwitchPosition(which,
  coord)` (both sides) declares where a switch physically sits; default `0`
  reproduces the old "switch IS the origin" behaviour. On a homing trip the
  board now sets the counter to the switch's declared coordinate (was a
  hardcoded `0`), then travels to `0`. **`setHome()` became a frame re-zero**:
  the current position becomes `0` (or a passed value) and the soft limits +
  switch positions shift by the same offset, so they keep pointing at the same
  physical spots — the board echoes the shifted `SET_POSITION` / `SET_LIMITS` /
  `SET_SWITCH_POS`, and announce/reconnect replays the resulting **absolute**
  state (never the one-shot shift, which would double-apply). Removed the old
  `_homeValue` / `_homeSet` (home ≡ 0, nothing separate to store). This is the
  CNC/work-coordinate split: the switch is a fixed physical reference, home is a
  user origin sitting at a known offset (e.g. min switch at `-500`, home at
  `0`). Deliberate edge choices: only **enabled** soft limits shift on re-zero;
  switch coords shift only for ends with a configured pin or an already-non-zero
  coordinate. README homing section rewritten and `examples/stepper-example`
  updated (per-switch "set pos" controls, reworked Home row). **Zero bench
  time** — the stepper-homing item in the caveat list above already covers the
  switch-coordinate adopt.
- **Message channel + frame monitor (prior session)** — filled the "no
  message sending outside defined hardware" gap. A new **core** command
  `CMD_MESSAGE 0x0B` carries user-defined **key/value** messages (not tied to
  any pin/device), symmetric both directions, for `int`/`bool`/`float`/`char`/
  text/blob. **Reuses the existing frame unchanged** (no codec edits): value
  type + flags packed in the `TARGET` field (`MSG_TARGET`/`MSG_TYPE`/`MSG_FLAGS`
  in defs.h), scalar value in one param (TYPE_MASK bit0 for FLOAT), key + any
  text/blob value in the payload as `[keyLen:u8][key][value]`. **Routed by CMD,
  not target range** — the flags in the target high byte can push it past
  `RESERVED_START`, so both sides check `cmd == CMD_MESSAGE` before the
  extension-routing test (JS `_dispatch`, Arduino `_handleWsEvent`).
  **API — one verb `send`, both sides**, disambiguated by key type (string =
  message, number = pin), so it composes with the existing pin `send`/
  `digitalWrite` (JS `send` is the internal transport; a string first arg is
  never a valid frame, so the branch is safe and back-compatible — no call-site
  changes). JS: `arduino.send(key, val, {retain, broadcast})`, `watch(key, cb)`,
  `on('message', {key,value,type})`, `messages[key]` cache. Arduino: typed
  `send()` overloads (`int`/`double`/`bool`/`char`/`const char*`) + `sendBlob`,
  `watch(key, cb)`, `onMessage(cb)` — callbacks are plain fn-pointers
  `void(const Message&)`; `m.type` selects `asInt/asBool/asFloat/asChar/text/
  blob`. **`retain`** (opt-in): board stores latest per key in a fixed table
  (`NUM_RETAINED 8`, scalars always, text/blob ≤ `RETAIN_VALUE_MAX 48` B else
  warn+skip) and replays via `_announceMessages` on connect, in the same sync
  step as pins/extensions. **`broadcast`** (per-message flag, per Scott's
  choice — "something in the message that says it's for all"): board relays a
  browser message to the OTHER browsers (send-to-all-except-sender, exact bytes)
  **+** the sketch; default is browser→sketch only. A sketch `send` always
  reaches every browser. **Frame monitor (both sides, name-decoded):**
  `arduino.on('frame', {dir,cmdName,target,params,payload})` / `monitor(fn)` and
  `Pardalote.onFrame(cb)` see **every** frame in/out — `watch`/`on('message')`
  are just the inbound-MESSAGE-filtered view of this one stream. Taps sit on the
  existing funnels (JS `_dispatch` in / `_flush` out; Arduino `_handleWsEvent`
  in / `sendFrame`+`broadcastFrame` out), **guarded so zero cost with no
  listener**. A `(deviceId,cmd)→name` table in `internal/frame_names.h` +
  JS `_FRAME_NAMES`/`frameName()` (maintained by hand alongside defs.h, hex
  fallback) makes output read `SERVO_WRITE`, `MESSAGE`, … Also: `FrameBuilder`
  gained `addByte`/`addBytes`; the JS `Arduino` class gained `off()`.
  Constraints: `MAX_MESSAGE_KEY 24`, `NUM_WATCHERS 12`, single-frame values
  (Arduino→JS text/blob ~240 B via the 256-B FrameBuilder; JS→Arduino only
  WS-buffer-bound). New examples: `examples/messaging-example/` (browser + .ino,
  incl. a live traffic inspector) and IDE `examples/messaging/`. **Zero bench
  time** — hardware TODO below.
- **Stepper** (`PardaloteStepper.h` + `stepper.js`) — AccelStepper-backed;
  DRIVER + 4-wire; `moveTo`/`move`/`moveToTimed`/`runSpeed`/`stop`, speed/accel,
  soft limits, `setPosition`, read poll, `done` event, `target`. `MAX_STEPPERS 6`.
- **Bus servo** (`PardaloteBusServo.h` + `busServo.js`) — Feetech ST/SC via the
  SCServo lib; `write`/`writeTimed`/`runSpeed`/`setMode`/`torque`/`calibrate`/
  `scan`/`ping`/`setId`/`setLimits`, feedback read, `target`, `done` (board polls
  the Moving flag). `configureBus`. `MAX_BUS_SERVOS 16`.
- **Servo timed moves** (`PardaloteServo.h` + `servo.js`) — `writeTimed`/`stop`,
  on-board interpolation, `done` event. `MAX_SERVOS 8`.
- **Groups** (`Group` class in `pardalote.js` + per-member adapters) —
  `write()` (one batched message), `writeTimed()` arrive-together,
  `whenDone()` **feedback-confirmed** (awaits every moved member's real
  `done`, safety timeout), `read()`, `stop()` (halts member motion).
- **Bus servo SyncWrite** — one hardware packet, simultaneous latch; matched
  per-servo speeds for arrive-together.
- **Arduino-side actuator API** — global objects `PardaloteServo` /
  `PardaloteStepper` / `PardaloteBusServo`: `scan()`, `read(id)`,
  `write`/`moveTo(id,…)`, bus-servo `isMoving(id)`/`arrived(id)`. Backed by
  `Pardalote.command()` (local loopback dispatch).
- **Auto-echo** — a *sketch* write broadcasts the command to browsers so the
  browser record stays in sync (servo→`angle`, stepper/bus servo→`target`).
- **Examples** — `stepper-example`, `busservo-example`, `coordinated-motion-example`,
  `arduino-read` (all browser examples verified to load & run).
- **Vocabulary standardized** — completion event is **`done`/`onDone`** (not
  `moveDone`); an item in a group is a **`member`** (not `channel`).
- **setHome()/home() on all three actuators + group (this session)** —
  `setHome(value)` declares home (no-arg = "here is home"); `home()` goes
  there; `group.home(duration?)` fans out (NOT arrive-together). Servo
  (default home 90°) and bus servo (default centre of range) are JS-side
  moves — `home(duration)` = writeTimed. Stepper is the real machinery.
  **Datum model (revised after discussion): the homing switch IS the
  origin** — the trip always sets the counter to 0; home is any coordinate
  (`setHome(800)` = 800 steps from the switch). A two-datum CNC model
  (`setSwitchPosition`) was built first, then removed as an unnecessary
  concept — with a MAX-only switch, that switch reads 0 and travel is
  negative. `setHome(value)` = `SET_HOME 0x55` (board-replayed, no-arg
  resolved board-side from the counter and echoed back). `home({speed}?)`
  (`HOME 0x40`, now implemented) runs a board-side
  SEEK→BACKOFF→TRAVEL state machine in
  `loop()` that **bypasses the generic switch/DONE logic entirely** while
  active (else the deliberate switch hit would spew LIMIT/DONE): seek at
  `speed` (default maxSpeed/4) toward MIN-else-MAX switch, on trip
  `setCurrentPosition(switchPos)` + silent SET_POSITION broadcast, back
  off until released, accel-travel to home, DONE. No switch → plain
  moveTo(home). Any explicit motion command (`cancelHoming`) aborts the
  routine. `stepper.home()` ignores a bare-number arg so `group.home
  (duration)` can fan out safely. SEEK+BACKOFF capped at 30 s default
  (`home({ timeout })` overrides; expiry → hard stop + `'homeFail'` + DONE).
- **Soft limits unified across all three actuators (this session)** —
  `setLimits(min, max)` / `clearLimits()` now exist on Servo (angle,
  `CMD_SERVO_SET_LIMITS 0x54`, new), Stepper (steps, unchanged), and
  BusServo (counts, **reworked**). All three are board-RAM clamps applied
  to every command path — browser writes, sketch writes (via the shared
  handler), timed moves, and group sync frames (SYNC_TIMED / SYNC_MOVE /
  SyncWrite clamp per record via `logicalForServoId`). JS mirrors the
  clamp so cached `angle`/`target` matches what the board applied — bus
  servo clamps BEFORE distance/speed matching so arrive-together stays
  true. **BusServo change of behavior:** `setLimits` no longer writes the
  servo's EEPROM limit registers (decision: no EEPROM wear — it used to
  re-burn on every reconnect replay — and no reliance on the unverified
  `unLockEprom`/`writeWord` path; note `setMode`/`calibrate` still use
  EEPROM). Limits now live on the board: power-cycling just the servo
  keeps them (board re-clamps); replacing the board loses them. Frame
  shape gained an `enabled` flag: `[id, min, max, enabled]` on all three.
- **Stepper limit switches (this session)** — none/one/two per stepper,
  `setLimitSwitch(MIN|MAX, pin, trigger=LOW)` / `clearLimitSwitch()` on both
  JS and sketch (`PardaloteStepper.setLimitSwitch(id, LIMIT_MIN, pin)`).
  Protocol: `SET_SWITCH 0x52` (config + announce replay + sketch echo),
  `LIMIT 0x53` (Ar→JS trip event). **The trip is board-side** in
  `StepperExt::loop()`: direction-aware (speed-sign, `distanceToGo`
  fallback pre-first-step; moving away from a pressed switch always
  allowed), instant kill via `setCurrentPosition(currentPosition())` (no
  decel ramp — deliberate; counter is suspect after a trip, re-zero with
  `setPosition()`), trip-on-first-read but 20 ms release debounce (latch
  prevents LIMIT-frame spam; re-stops each loop while pressed). Browser
  gets `'limit'` event + `limitHit` state (cleared by next move, via
  `_armDone`); the normal DONE edge follows so `whenDone()` settles `true`.
  Wiring default: active-LOW + `INPUT_PULLUP` (switch to GND); active-HIGH
  uses `INPUT_PULLDOWN` where the core has it, else plain `INPUT`.
  Constants are **`LIMIT_MIN`/`LIMIT_MAX` on BOTH sides** (JS consts in
  pardalote.js, #defines in defs.h) — bare MIN/MAX was rejected because
  some Arduino cores define MIN/MAX macros, and JS followed for
  consistency. Also added a 4-param `Pardalote.command()` overload.
- **Move-naming convention settled (this session).** Singles keep their
  legacy verbs (`write`/`writeTimed` for servos & bus servos, `moveTo`/
  `move`/`moveToTimed` for steppers — Arduino Servo-lib / AccelStepper
  heritage). The **Group maps those terms logically**: `group.write(values)`
  = immediate batched write (was `set()`), `group.writeTimed(targets,
  duration)` = arrive-together with **positional** duration matching the
  singles' `writeTimed(value, duration)` shape (was `moveTo(targets,
  {duration})`). Async unified as **`whenDone({timeout}?)`** on Servo,
  BusServo, Stepper, *and* Group — moves stay chainable, `await
  x.writeTimed(...).whenDone()` resolves `true` on real (feedback-confirmed)
  arrival, `false` on safety timeout (default `max(duration × 2, 10 s)`; `0`
  = forever). Replaced `moveToAsync`/`moveAsync` (removed, **no aliases** —
  not deployed). Internals: each move arms `_movePromise` at send time (via
  `_armDone(duration)`), including inside the group adapters, so a late
  `whenDone()` can't miss the `done`; moves that never "arrive" (`servo.
  write`, `runSpeed`) clear it so `whenDone()` resolves immediately.
  `servo.stop()` settles awaiters locally (board STOP sends no DONE). Also
  fixed: **`group.stop()` now halts member motion** (mirroring
  `member.stop()`); stop polling with `read(END)`, same as singles. And
  continuous rotation is **`runSpeed()` on both stepper and bus servo** —
  the bus servo's `writeSpeed` was renamed (it was our expansion of
  Feetech's `WriteSpe`, not a vendor term worth preserving; AccelStepper's
  `runSpeed` is verbatim). JS-side only — the C++ internals still use
  `writeSpeed`/`WriteSpe`.

- **Sketch-created servos (this session)** — `int pan = PardaloteServo.
  attach("pan", 9)` creates a servo ON THE BOARD and every browser
  receives it automatically as `arduino.pan` — a real JS `Servo`
  instance, indistinguishable from a browser-created one (write/
  writeTimed/whenDone/limits/groups all work; verified by feeding the
  actual firmware announce bytes into the JS lib). **API decision
  (after much discussion): no `.share()` for actuators.** `share()`
  exists for pins because pins live outside Pardalote (sketch does
  pinMode, share only informs); a Pardalote servo has no outside —
  creating it IS sharing it. Rejected along the way: (a) a separate
  attach-then-share two-step (a "managed but invisible" middle state
  nobody needs); (b) adopting a user-owned `Servo` object (Servo's
  methods aren't virtual → direct writes would bypass the choke
  point: no soft-limit clamp, stale browser cache — the choke point
  IS the value proposition). Private servos = use the plain Servo/
  ESP32Servo lib directly. Wire: `CMD_SHARE 0x56` Ar→JS `[logicalId]`
  + name payload — the VALUE is reserved across ALL device IDs; the
  JS core intercepts it generically (`_onShare`) and constructs the
  class registered via `registerExtensionType(Servo)` (each extension
  file registers at its bottom — servo.js only, so far). Board
  allocates ids TOP-DOWN (7,6,…), JS bottom-up, so no collision until
  the range is full (JS `add()` also skips board-held ids; a genuine
  collision is refused with a warning). Sketch attach is idempotent
  per name (≤15 chars, `MAX_SHARE_NAME`); names shadowing the core
  API (`"connect"`) are refused JS-side. `announce()` replays SHARE →
  ATTACH → WRITE (→ LIMITS) per sketch-owned servo, so late browsers
  and reconnects sync; `'share'` event fires before `'ready'`. Board
  switch (`connect()`) drops board-created instances; `_reRegister`
  skips them (sketch owns their lifecycle). New example:
  `examples/shared-servo-example/`. Steppers/bus servos: same pattern,
  deliberately deferred until the servo path is bench-proven.

- **Sketch-created steppers & bus servos (this session)** — the servo's
  sketch-attach pattern extended to the other two actuators, so a sketch
  can now do `int base = PardaloteStepper.attach("base", 2, 3, 4)` (or
  `attach4wire("coil", 8,9,10,11)`) and `int wrist =
  PardaloteBusServo.attach("wrist", 5)` and every browser gets
  `arduino.base` / `arduino.wrist` automatically (a full Stepper /
  BusServo instance, indistinguishable from a browser-created one). The
  JS half needed only `registerExtensionType(Stepper)` /
  `registerExtensionType(BusServo)` — the core `_onShare` /
  reconnect / `_sharedFromBoard` machinery was already fully generic.
  Arduino side mirrors `ServoExt` exactly: `_sketchOwned[]` + `_names[]`,
  `sketchAttach()` (idempotent per name, ids allocated TOP-DOWN so they
  can't collide with the browser's 0-up ids), `broadcastShare()`, and
  `announce()` replays SHARE → attach/state per sketch-owned instance.
  Refactored the attach/profile replay into a shared `sendAttachState
  (id, unicast, clientNum)` so the sketchAttach broadcast and the
  announce unicast can't drift. All three `attach`es return the **logical
  id** (see the bus-ownership rework below — bus servo was reworked from
  hardware-id to logical-id addressing this session). Bus-servo `series`
  defaults to `BUSSERVO_SERIES_ST`. Attach still routes through
  `Pardalote.command()` (the browser code path) — the stepper's 6-param
  attach needed new **5- and 6-arg `command()` overloads** in Pardalote.h.
  New IDE examples: `examples/shared-stepper/`, `examples/shared-busservo/`.
  Verified by the stub-compile check (all three headers, ESP32 path,
  attach surface instantiated). **Zero bench time** — hardware TODO:
  a sketch attach with a browser already connected (mid-loop SHARE),
  a browser connecting after the sketch attached (announce replay),
  reconnect after board reset re-materialises it, and idempotent
  re-attach by name.

- **Bus servo: bus-ownership model + logical-id sketch API (this
  session)** — settled what "inside vs outside Pardalote" means for a
  serial bus, then reworked the sketch API to match. **Decision: the BUS
  is the unit of ownership.** A serial bus is either a Pardalote bus or
  it isn't — never shared — and every servo on a Pardalote bus is
  Pardalote hardware. A private bus servo lives on a SEPARATE UART driven
  by the sketch's own raw SCServo (Pardalote never configures/scans/drives
  it) — the exact parallel of a private PWM servo on the raw Servo lib,
  except the boundary is per-bus (shared wire) instead of per-pin. This
  fell out of noticing that (a) *all* actuators can live outside Pardalote
  — pins are the special case, not the rule — so the earlier "a Pardalote
  actuator has no outside" reasoning was wrong; and (b) for a shared bus,
  the only enforceable boundary is the whole bus, because `scan()`
  traverses the physical wire. Consequences, now implemented:
  **`PardaloteBusServo` is logical-id addressed** like servo/stepper —
  `attach(name, busId, series?)` returns the **logical id**, and
  `write/read/feedback/isMoving/arrived/torque` take it. The hardware
  (bus) id is only an *address* now: used in `attach`, `scan`, and the
  SyncWrite packet, never as the control handle (it can't be — logical
  ids are dense 0–15 slots; bus ids are sparse 1–253). **`scan()` is
  reframed as discovery** (hardware ids on the bus; every responder is
  Pardalote's — attach the ones you want). **Removed the drive-by-raw-
  hardware-id path** (`writePosById`/`setTorqueId`) — it let the API poke
  a servo the system didn't model AND skipped soft limits; control is now
  attached-instance-only. Writes route through `Pardalote.command()` and
  auto-echo target (clamped) + torque so the browser record stays synced.
  The **browser side needed no functional change** — it was already
  logical-id addressed; only doc comments updated. `beginAwaitDone` is
  now armed inside the WRITE handler (the sketch write goes through it),
  not by the accessor — so it was **re-privatised** (it had been made
  public only for the old direct-write accessor; see the verification note).

- **Framework completion: sketch attach() for NeoPixel, Ultrasonic, MPU
  (this session)** — extended the sketch-creates-it, browser-sees-it
  pattern from the three actuators to the sensor/output extensions, so
  *every multi-instance device* can now be added from the sketch OR the
  browser. Each got the same recipe: `_sketchOwned[]`/`_names[]`,
  `sketchAttach()` (top-down ids, idempotent per name), `broadcastShare()`,
  announce-SHARE-first, a `Pardalote<X>` access object, and
  `registerExtensionType(X)` on the JS side (the only JS change needed —
  the core `_onShare` was already generic). **No auto-echo for these**
  (decided): they have no value-clamping choke point, and a NeoPixel
  framebuffer is too heavy to mirror per-frame — so sketch-attach means
  "create + make browser-visible," and connecting browsers get current
  state via `announce`, not live per-frame pushes. Sketch surfaces:
  NeoPixel → `attach(name,pin,count,type?)` + `setPixel/fill/clear/
  brightness/show`; Ultrasonic → `attach(name,trig,echo?)` + `read()`
  (cm, blocking) / `readInches` / `setTimeout`; MPU → `attach(name,
  model?,addr?,sda?,scl?)` + `read()` (→ `PardaloteMPUReading`) /
  `setAccelRange`/`setGyroRange`/`calibrate`. **MPU was the awkward one:**
  its attach carries the model NAME as a payload, which `Pardalote.
  command()` (int-params only) can't send — so the attach body was
  refactored into a shared `attachDevice(id,addr,code,sda,scl)` that both
  the browser handler and `sketchAttach` call (truly one code path),
  and `sketchAttach` broadcasts the SHARE/ATTACH(+model payload)/range
  frames itself. Sketch reads for the sensors are board-local (blocking
  I2C/pulseIn), not broadcast. New IDE examples: `shared-neopixel/`,
  `shared-ultrasonic/`, `shared-mpu/`. Stub-compile now covers all six
  extension headers (added Adafruit_NeoPixel/Wire stubs). **Camera is the
  only device without sketch attach** — deliberately deferred (singleton,
  ESP32-only, conceptually unlike the multi-instance devices). Zero bench
  time on all three.

### Protocol map (for adding commands)
Device IDs: neopixel 200, servo 201, ultrasonic 202, mpu 203, camera 204,
stepper 205, busservo 206. Command blocks: servo `0x14–0x1D` + limits
`0x54`, stepper `0x33–0x40` (0x40 = HOME, now implemented) + timed
`0x4F–0x50` + switches `0x52–0x53` + home `0x55`, bus servo `0x41–0x4E`
+ `DONE 0x51`. `CMD_SHARE 0x56` is reserved across ALL device IDs
(sketch-created objects; now servo, stepper, bus servo, NeoPixel,
ultrasonic, AND MPU — every device except camera). Next free device-scoped: `0x57`.
**Core** commands run 0x00–0x0A; `CMD_MESSAGE 0x0B` (the message channel,
this session) is the newest — routed by CMD, not target range. Next free
core cmd: `0x0C`. See `src/internal/defs.h`.

---

## Loose ends (deferred, in rough priority)

1. **LLM control layer** — the original studio goal, deliberately deferred. The
   groundwork *is* the substrate for it: `group.read()` → policy → `group.writeTimed()`
   is the LeRobot-style loop.
2. **Record / playback** (teach-by-demonstration) — capture poses (torque off) →
   replay. The natural bridge to the LLM layer, and a headline studio feature.
3. **Arduino-side group moves** — coordinated group motion is browser-only; a
   sketch can't issue one.
4. **Browser-side `isMoving`/`arrived`** for bus servo — currently Arduino-only;
   a browser equivalent needs a small protocol command.
5. ~~**Stepper limit-switch homing**~~ — **DONE this session** (see
   setHome/home below), including a **seek/back-off cap** (default 30 s,
   `home({ timeout })`): on expiry the board hard-stops, broadcasts
   `CMD_STEPPER_HOME [id, position]` Ar→JS (JS emits `'homeFail'`), then
   DONE — mirroring the limit-trip pattern, so `whenDone()` always settles.
   TRAVEL is a normal accel move and is deliberately uncapped.
6. **SC-series verification** — ST is the primary/verified-by-design path.
7. ~~**Sketch-created steppers & bus servos**~~ — **DONE**, and since
   extended to **NeoPixel, Ultrasonic, and MPU** (see the framework-
   completion entry under What's built). Every multi-instance device now
   has a sketch-side `attach(name, …)` + `registerExtensionType`. **Camera
   is the only device still browser-only** (singleton, ESP32-only) —
   deferred by choice. Still zero bench time — confirm on hardware.

---

## Non-obvious design decisions (the "why")

- **Groups hold member instances but never call `member.moveTo()`.** Individual
  methods flush a frame *immediately* (no batching) and can't coalesce several
  bus servos into one SyncWrite. So the split is: **the member owns its state;
  the group owns coordinated sending.** The adapters (`_memberWrite`,
  `_memberSetEncode`, `_memberMoveEncode`) are methods *on* the instance — they
  update its state exactly as the individual methods do, and *return* frames for
  the group to batch into one message.
- **Bus-servo `done` is polled by the board, not pushed.** The half-duplex
  master-slave bus can't send unsolicited data — a servo only replies when
  asked. So the board polls the servo's own `Moving` flag (`ReadMove`) at ~30 Hz
  after a write and emits `done` when it settles. **Reading does not interrupt
  motion** — it's a concurrent status query (LeRobot polls all joints at 30 Hz
  *while they move*). Steppers/servos get `done` for free (board-detected).
- **`position` sources differ, and that's real, not a bug.** Stepper `position`
  = the board's **step counter** (open-loop: what was commanded, free to read,
  no proof the shaft moved). Bus servo `position` = the servo's **encoder**
  (closed-loop: true shaft angle, costs a bus read). A PWM servo has **no
  feedback** — its `angle` is command-*equals*-state.
- **`target` vs `position`.** `target` = commanded destination, set *instantly*
  by `moveTo`/`write`. `position` = feedback; it only advances with polling (or,
  for the stepper, jumps to final on `done`). Stepper `target` **self-corrects**
  from read feedback (`position + distanceToGo` = the board's real target).
- **No auto-poll on write/move — deliberate.** A pin read is side-effect-free,
  so auto-polling it is pure benefit; a write/move already does the work, and
  fetching the value back is extra cost (a bus transaction for the servo). Use
  `read(interval)` when you want live `position`.
- **Auto-echo replaces an explicit actuator `send()`.** Pins have
  `Pardalote.send(pin, value)`; actuators don't need a `send` — a sketch write
  echoes the command to the browser automatically. Only *Arduino-initiated*
  writes echo (browser writes don't loop back). `share`/`send` for pins are
  unchanged. And actuators don't have a `share()` either — see the
  sketch-created servos entry above: creation (attach) and browser visibility
  are one act. Everything in Pardalote's table is browser-visible, by design.
- **Inside vs outside Pardalote is about *attaching*, not about existence.**
  (Corrected this session — an earlier note claimed "a Pardalote actuator has
  no existence outside Pardalote," which is false.) *Every* actuator can live
  outside Pardalote: a servo on a pin driven by the raw Servo lib, a bus servo
  on its own UART driven by raw SCServo — Pardalote never hears about them.
  `attach` is the deliberate act of bringing hardware *inside*; there's no
  half-in state and no auto-adoption (attach outside and it stays outside).
  Pins are the special case (they're a sketch-owned primitive, hence
  `share()`), not the general rule.
- **For bus servos the inside/outside boundary is per-BUS, not per-servo.**
  PWM servos are isolated per pin, so inside/outside is decided per servo and
  the two never interact. Bus servos share one wire, and `scan()` traverses
  the whole physical bus — so the only enforceable boundary is the entire bus.
  Hence: **a serial bus is Pardalote's or it isn't, never shared**; every
  servo on a Pardalote bus is Pardalote hardware; a private bus servo lives on
  a *separate* UART with raw SCServo. This is why `PardaloteBusServo` is
  logical-id addressed (attach = adopt → instance) with no drive-by-raw-id
  path, and why `scan()` is framed as discovery of Pardalote's own bus rather
  than a set the sketch controls directly.

---

## How things were verified

**Verification upgrade (this session): stub-compile the firmware.** Beyond
brace-balance/grep, the Arduino headers are now checked with
`g++ -fsyntax-only -std=c++17` against small hand-written stubs of
Arduino.h / Servo.h / AccelStepper.h / SCServo.h / Adafruit_NeoPixel.h /
Wire.h plus the REAL defs.h (a sketch-shaped TU including all six
extension headers on the ESP32 path, exercising each sketch attach()).
This caught a genuine pre-existing compile error brace-balance missed:
`PardaloteBusServoAccess::write()` called `BusServoExt::beginAwaitDone()`,
which was **private** — the library would not have compiled in the Arduino
IDE once a sketch used `PardaloteBusServo.write()`. Fixed at the time by
making `beginAwaitDone` public. (It's since been re-privatised — the
sketch write now routes through the WRITE handler, which arms the poller
itself, so nothing outside `BusServoExt` calls it.) When resuming, prefer this stub-compile check for
any firmware edit (rebuild the stubs from the `_st.`/`_sc.` method greps —
they're ~60 lines).

JS: temp `_*.html` test pages served from a fresh local port (cache-busting via
`?v=`), decoding the real wire frames and asserting state — then deleted. Arduino:
brace-balance + grep + structural review. When resuming, keep using throwaway
test pages on a fresh port for the JS half; don't trust the browser cache across
library edits (a stale `pardalote.js` will silently run old code — bump the port
or add `?v=`).

## File layout
- `pardalote-js/` — browser library (`pardalote.js` core + `Group`, one file per
  extension) and per-board pin aliases.
- `pardalote-arduino/library/Pardalote/src/` — firmware: `Pardalote.{h,cpp}`,
  `Pardalote<Extension>.h`, `internal/{defs,protocol,extensions,…}`.
- `examples/` — browser (p5.js) examples. `…/examples/*/` (IDE) — minimal `.ino`s.
