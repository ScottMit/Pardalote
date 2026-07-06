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

## ⚠️ Standing caveat: none of the Arduino code is bench-tested

Everything Arduino-side is **structurally verified only** (brace/wire-format
checks, careful review) — there is **no Arduino toolchain, no AccelStepper /
SCServo / ESP32Servo libraries, and no physical actuators** in the dev
environment. The **JavaScript side is verified in-browser** (temp test pages on
a local server, decoding the actual wire frames).

**First things to confirm on real hardware:**
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

---

## What's built this session

- **Stepper** (`PardaloteStepper.h` + `stepper.js`) — AccelStepper-backed;
  DRIVER + 4-wire; `moveTo`/`move`/`moveToTimed`/`runSpeed`/`stop`, speed/accel,
  soft limits, `setPosition`, read poll, `done` event, `target`. `MAX_STEPPERS 6`.
- **Bus servo** (`PardaloteBusServo.h` + `busServo.js`) — Feetech ST/SC via the
  SCServo lib; `write`/`writeTimed`/`writeSpeed`/`setMode`/`torque`/`calibrate`/
  `scan`/`ping`/`setId`/`setLimits`, feedback read, `target`, `done` (board polls
  the Moving flag). `configureBus`. `MAX_BUS_SERVOS 16`.
- **Servo timed moves** (`PardaloteServo.h` + `servo.js`) — `writeTimed`/`stop`,
  on-board interpolation, `done` event. `MAX_SERVOS 8`.
- **Groups** (`Group` class in `pardalote.js` + per-member adapters) —
  `set()` (one batched message), `moveTo()` arrive-together, `moveToAsync()`
  **feedback-confirmed** (awaits every member's real `done`, safety timeout),
  `read()`.
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

### Protocol map (for adding commands)
Device IDs: neopixel 200, servo 201, ultrasonic 202, mpu 203, camera 204,
stepper 205, busservo 206. Command blocks: servo `0x14–0x1D`, stepper
`0x33–0x40` + timed `0x4F–0x50`, bus servo `0x41–0x4E` + `DONE 0x51`. See
`src/internal/defs.h`.

---

## Loose ends (deferred, in rough priority)

1. **LLM control layer** — the original studio goal, deliberately deferred. The
   groundwork *is* the substrate for it: `group.read()` → policy → `group.moveTo()`
   is the LeRobot-style loop.
2. **Record / playback** (teach-by-demonstration) — capture poses (torque off) →
   replay. The natural bridge to the LLM layer, and a headline studio feature.
3. **Arduino-side group moves** — coordinated group motion is browser-only; a
   sketch can't issue one.
4. **Browser-side `isMoving`/`arrived`** for bus servo — currently Arduino-only;
   a browser equivalent needs a small protocol command.
5. **Stepper limit-switch homing** — `CMD_STEPPER_HOME 0x40` is reserved,
   unimplemented.
6. **SC-series verification** — ST is the primary/verified-by-design path.

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
  `Pardalote.send(pin, value)`; actuators didn't need a `share` (the browser
  *created* them) and now don't need a `send` either — a sketch write echoes the
  command to the browser automatically. Only *Arduino-initiated* writes echo
  (browser writes don't loop back). `share`/`send` for pins are unchanged.

---

## How things were verified

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
