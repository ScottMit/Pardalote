# Pardalote — bench-test checklist (pre-1.0.0)

Derived from the bench log in [PROJECT-STATUS.md](PROJECT-STATUS.md). Covers
**every open (⬜) item** blocking 1.0.0, plus a lean **regression pass** on the
core paths a firmware/JS change can silently break. Confirmed (✅) feature-tests
from the 2026-07 runs are *not* repeated except where listed under Regression.

Legend: **[ESP32]** / **[R4]** = board; **[R4-M]** = UNO R4 Minima;
**[both]** = run on ESP32 and UNO R4 WiFi. Tick `[x]` when passed on hardware.

---

## A. Core regression pass (run first, each board, after any firmware/JS change)

Fast confidence sweep — all were green in 2026-07, re-run to catch drift.

- [ ] **A.1 Transport & handshake [both]** — board joins WiFi, IP on Serial @115200; browser `connect`→`ready`; `arduino.analogMax` correct (4095 ESP32 / 1023 R4); power-pull → auto-reconnect (backoff, no reload); 2nd tab reaches `ready` with live state.
- [ ] **A.2 Pins [both]** — `digitalWrite(2,…)` toggles LED; physical button ↔ browser mirror stays synced (last-writer-wins); `share(A0, ANALOG_INPUT_MODE)` auto-polls, values span full ADC range. *(ESP32: pot must be on an ADC1 pin — ADC2 reads 0 with WiFi up.)*
- [ ] **A.3 Messaging channel [both]** — `send('led',bool)`→`watch` drives LED; retained `send` updates `messages[...]`; retain replays to a late-reloading browser pre-`ready`; broadcast reaches 2nd browser (no self-echo) + sketch; frame monitor decodes traffic with no perf hit while a pot/servo streams.
- [ ] **A.4 PWM under load [R4]** — drag an `analogWrite` slider hard; latency stays flat, no growing send queue, no WebSocket drop. Confirms the loop-starvation fix (LED-matrix scroll stops on connect) + the 20 ms per-pin throttle still hold.

---

## B. ESP32 — open items from the Phase 0–11 run

### Sketch-created servo (Phase 4)
- [ ] **B.1 (4.4) Idempotent re-attach** — `attach("pan", 18)` twice → **one** servo, not two. *(Claimed in an earlier summary but never actually exercised.)*
- [ ] **B.2 (4.5) UNO R4 path** — confirm the sketch-created-servo path compiles & runs on R4 (only the ESP32 path has been run; host stub-compile covered ESP32 defines only). *(Belongs to the R4 work in §D too.)*

### Servo gesture player — expressive motion (NEW, zero bench)
On-board segment schedule via `CMD_SERVO_GESTURE` (0x58); JS byte-encoding
verified in-browser, board playback unexercised. JS encoder ↔ firmware parser
layout confirmed: `[id,flags,count]` + N×`{curve u8, dur u16, value i32}` BE.
- [ ] **B.2a Relative gesture plays on-board [both]** — `pan.gesture([{by:25,dur:250,curve:'easeOut'},{by:-25,dur:400,curve:'easeInOut'}])`: smooth, **no WiFi streaming** (pull network mid-gesture → it still completes on the board); lands at predicted rest; `CMD_SERVO_DONE` fires once; `whenDone()` resolves.
- [ ] **B.2b Curves visibly distinct [ESP32]** — `easeIn` / `easeOut` / `easeInOut` render clearly different velocity profiles; **`back` overshoots** past the segment end, then settles.
- [ ] **B.2c Overshoot clamps at limits** — a `back` segment ending near 180° (or inside `setLimits`) is **re-clamped per tick** — no wrap/glitch past the limit.
- [ ] **B.2d Segment chaining** — multi-segment timeline has **no visible pause/drift** at boundaries; total ≈ Σ durations (timeline uses `start+dur`, not `now`).
- [ ] **B.2e Absolute mode** — `pan.gesture([{to:120,dur:400,curve:'easeInOut'}], {absolute:true})` reaches the absolute target.
- [ ] **B.2f Interrupt clears schedule** — `write()` / `writeTimed()` / `stop()` mid-gesture **abandons it cleanly** (no resumed segments); `_segCount` cleared.
- [ ] **B.2g Segment cap** — >16 segments → extras dropped + a `warn`, board does not overrun `MAX_SERVO_SEGMENTS`.
- [ ] **B.2h Resolution check (obs)** — on a slow gentle ease, note whether integer-degree writes show 1° stair-stepping → decides the degrees→microseconds follow-up.

### Stepper gesture player — expressive motion (NEW, zero bench)
On-board segment schedule via `CMD_STEPPER_GESTURE` (0x59), new `MODE_EASED`:
each tick follows the segment's eased position (`pardaloteEase`) at a
feed-forward speed (curve slope via central difference); `runSpeedToPosition`
lands each segment; `from` re-captured from `currentPosition()` per segment.
JS byte-encoding verified in-browser; board playback unexercised.
- [ ] **B.5a Relative bounce plays on-board [both]** — `lift.gesture([{by:800,dur:350,curve:'easeOut'},{by:-800,dur:550,curve:'easeInOut'}])`: runs on the board (pull network mid-gesture → completes); **no homing needed**; `CMD_STEPPER_DONE` fires once; `whenDone()` resolves; ends within ~1 step of start (per-segment recapture ⇒ no drift accumulation).
- [ ] **B.5b Overshoot is real** — a `back` segment drives **past** the target then reverses back (feed-forward velocity goes negative near t=1) — the lead-screw bounce. Confirm visible over-travel + return, not a hard stop at target.
- [ ] **B.5c Speed-cap raise + restore** — an eased move briefly exceeds the configured `maxSpeed` (velocity peaks above average) to hit the authored duration, then **restores** the user cap on finish. After a gesture, a plain `runSpeed()`/`moveTo()` obeys the original `maxSpeed` (guards the same class as B.6 homing-restore). Check no runaway.
- [ ] **B.5d Curve fidelity vs quantisation** — on a slow gentle ease-in (`shape'(0)=0`), steps come sparse at the ends → note any notchiness; microstepping should smooth it. Records whether feed-forward following is smooth enough or needs the analytic velocity schedule.
- [ ] **B.5e Segment chaining** — multi-segment timeline has no visible pause/drift at boundaries; total ≈ Σ durations (uses `start+dur`).
- [ ] **B.5f Absolute + soft limits** — `{to, absolute:true}` reaches absolute targets; a segment target beyond `setLimits` is clamped at the end.
- [ ] **B.5g Interrupt clears gesture + restores cap** — `moveTo`/`move`/`runSpeed`/`stop`/`hardStop`/`home` mid-gesture abandons it cleanly (`cancelEased`), no stray `DONE`, cap restored.
- [ ] **B.5h Limit switch during gesture** — a hardware limit trip mid-gesture still hard-stops on the board and emits `LIMIT`+`DONE` (the switch guard runs before the mode branch).
- [ ] **B.5i Segment cap** — >16 segments → extras dropped + `warn`, no overrun of `MAX_STEPPER_SEGMENTS`.

### Bus servo gesture player — expressive motion (NEW, zero bench)
On-board segment sequencer via `CMD_BUSSERVO_GESTURE` (0x5A). No per-tick loop:
each segment is one position write at a distance/duration-matched speed;
the board advances to the next segment when the servo's **Moving flag settles**
(the same feedback the DONE poller uses), and emits one `CMD_BUSSERVO_DONE`
after the last. `curve` byte accepted but NOT rendered intra-segment. `from`
captured live at gesture start (`readPos`), then chained from each target.
JS byte-encoding verified in-browser; board playback unexercised.
- [ ] **B.7a Relative sequence plays [both]** — `grip.gesture([{by:600,dur:400},{by:-600,dur:600},{by:80,dur:200}])`: each segment fires only after the previous **arrives** (Moving flag), not on a timer; exactly ONE `DONE` at the end; `whenDone()` resolves.
- [ ] **B.7b No mid-sequence DONE leak** — confirm intermediate segments do NOT broadcast `CMD_BUSSERVO_DONE` (only the final one). A stray DONE would resolve `whenDone()` early / break `group.gesture()` later.
- [ ] **B.7c Saturated-speed self-heal** — a segment whose distance/duration exceeds the servo's max still completes: it just takes longer and the next fires on true arrival (feedback, not timer). No desync/hang.
- [ ] **B.7d Absolute + soft limits** — `{to, absolute:true}` reaches targets; out-of-range (e.g. 9999) clamped on the board to series max (4095 ST / 1023 SC); soft `setLimits` respected.
- [ ] **B.7e Interrupt clears sequencer** — a direct `write`/`runSpeed`/`setMode`/`detach`/sync-write mid-gesture abandons it (`cancelBusGesture`) — the next settle must NOT resume the old sequence or hijack the new write into it.
- [ ] **B.7f No-answer / timeout mid-gesture** — if the servo stops answering (`MOVE_NO_RESP_MS`) or hits `MOVE_MAX_MS` mid-sequence, the gesture aborts cleanly with a final `DONE` (whenDone resolves, no stuck sequencer).
- [ ] **B.7g Segment cap** — >12 segments → extras dropped + `warn`, no overrun of `MAX_BUS_SERVO_SEGMENTS`.
- [ ] **B.7h `from` capture** — a relative gesture from a hand-posed start (torque off → pose → torque on) anchors on the live read, not a stale cache.

### Group gesture — coordinated expressive motion (NEW, zero bench)
`group.gesture({name: segments, ...})`: each member plays its own segment
schedule, all pushed in ONE batched message and played on the board clock.
Uneven lanes padded with a trailing hold (relative → delta 0; absolute → last
target) so all arrive together. Buckets by actuator type → one `CMD_*_GESTURE`
frame per type. Bus segments got a **duration floor** (advance only when
arrived AND authored dur elapsed) so a zero-distance pad actually waits and
lanes stay phase-locked. JS encoding + padding verified in-browser (mixed
servo+stepper+busservo, absolute + relative pads); board playback unexercised.
- [ ] **B.8a Mixed group arrives together** — servo + stepper + bus servo group, uneven lane durations: all members finish within a tick of each other; `whenDone()` resolves once all report done.
- [ ] **B.8b Padding holds, doesn't drift** — a short lane's trailing hold keeps the member still for the pad (esp. **bus servo** — verify the duration floor B.8d makes it wait, not race ahead). Absolute lane holds at its last target, not 0.
- [ ] **B.8c One batched message** — the whole group gesture goes out as a single WebSocket/serial message (one `CMD_SERVO/STEPPER/BUSSERVO_GESTURE` frame per present type, coalesced). Watch on `arduino.on('frame')`.
- [ ] **B.8d Bus segment duration floor** — a bus lane segment that settles before its authored `dur` still waits out `dur` before advancing (single-servo bus gesture too — authored 400ms segment takes ≥400ms). Guards group phase-lock and holds.
- [ ] **B.8e Overlap / follow-through** — neighbouring lanes with offset timings (one leads, one trails via a leading hold) read as coordinated follow-through, not lockstep.
- [ ] **B.8f Unsupported / bad lanes skipped** — a lane naming a non-gesture member, an unknown name, or an empty array → warn + skip, the rest still play.

### Stepper limit switches (Phase 6)
- [ ] **B.3 (6.2) Direction-aware guard** — hold the switch pressed, command a move in the *release* direction → it runs, no false re-trip. Exercises the `speed()`-sign / `distanceToGo` fallback.
- [ ] **B.4 (6.3) Release debounce** — trip, then slowly release → frame monitor shows a **single** clean LIMIT then DONE (no burst); `whenDone()` settles.
- [ ] **B.5 (6.4) Trip latency under load** — trip a switch while `read()` polling *and* another stream (pot/servo) is active → still an instant board-side stop, no missed trip.

### Stepper homing (Phase 7)
- [ ] **B.6 (7.4) Seek speed + maxSpeed restore** — `home({speed:400})`: seek speed honoured; after homing, the maxSpeed cap is restored for the TRAVEL leg (`setSpeed()` survives the between-legs restore). Same open item as AccelStepper timed-move clamp.
- [ ] **B.7 (obs) Move-after-disconnect** — confirm the reported "stepper visual moves after board disconnect" is understood/fixed.
- [ ] **B.8 (obs) 4-wire reverse** — a FULL4WIRE stepper wouldn't run in reverse; retest with a **second motor** to rule out the specific unit.

### Phase 8 — Sketch-created stepper (whole phase, zero bench)
- [ ] **B.9 Mid-loop attach** — `PardaloteStepper.attach("base",25,26,27)` while a browser is connected → `arduino.base` appears live.
- [ ] **B.10 Late-browser announce** — attach first, then connect → `arduino.base` exists at `ready` with correct pins/position; `'share'` before `'ready'`.
- [ ] **B.11 Reconnect after reset** — reset board → stepper re-materialises after auto-reconnect.
- [ ] **B.12 Idempotent re-attach by name** — attach twice → one stepper.
- [ ] **B.13 `attach4wire`** — 4-wire sketch-created form works; return value (logical id) feeds `moveTo`/`read`.

### NeoPixel / Ultrasonic / IMU — sketch-created + IMU ranges
- [ ] **B.14 (9.3) Sketch-created NeoPixel** — `PardaloteNeoPixel.attach(...)` + sketch `fill`/`show`; four materialisation cases; late browser sees current colours via announce.
- [ ] **B.15 (10.2) Sketch-created Ultrasonic** — `PardaloteUltrasonic.attach(...)` + sketch `read()` alongside a browser poll; four materialisation cases.
- [ ] **B.16 (11.3) IMU ranges** — `setAccelRange`/`setGyroRange` change scaling as expected.
- [ ] **B.17 (11.4) Sketch-created IMU** — `PardaloteIMU.attach("imu","6050")` identifies; sketch `read()` sane; model-payload attach round-trips to the browser; four materialisation cases.

---

## C. Bus servos — ST/STS path ✅ confirmed working (2026-08, see results log below); SC-series still least certain

- [ ] **C.1 Browser-driven attach/write/read [ESP32]** — attach on the shared UART, `write` moves the shaft, `read`/`position` returns the encoder value, torque enable/disable frees the joint.
- [ ] **C.2 `done` timing** — no false `done` at t=0 (40 ms startup guard); a long move isn't cut short (no-response watchdog, not a fixed timeout); board polls the `Moving` flag ~30 Hz.
- [ ] **C.3 STS3215 (ST/STS) path** — the primary path: `WritePosEx`, `SyncWritePosEx`, `CalibrationOfs`, `unLockEprom`/`writeByte`, `SMS_STS_ID` register all behave.
- [ ] **C.4 SC-series (SCSCL) path** — **least certain**: verify method names, especially `ReadMove` on the `SCSCL` class and the `SCSCL_ID` register constant.
- [ ] **C.5 Sketch-created bus servo** — `PardaloteBusServo.attach("wrist",5)`: attach brings the shared UART up; returned logical id feeds `write`/`read`; four materialisation cases (mid-loop, late announce, reconnect, idempotent).
- [ ] **C.6 Bus boundary** — a *private* bus servo on a separate UART (raw SCServo) is invisible to Pardalote; a servo on a Pardalote bus is Pardalote hardware. Confirm `scan()` traverses only the Pardalote bus.

---

## D. UNO R4 WiFi — extension/actuator surface (Phases 3–11, zero bench)

Core transport, pins, messaging, PWM already confirmed on R4. Everything below
mirrors the ESP32 coverage and is unrun on R4.

- [ ] **D.1 Servo (Phase 3)** — attach, `write`, `writeTimed`+`whenDone`, immediate-write cancel, soft-limit clamp, setHome/home.
- [ ] **D.2 Stepper (Phase 5)** — attach, `setMaxSpeed`/`setAcceleration`, `moveTo`/`moveToTimed`/`runSpeed`/`stop`, `read`, `enable`/`disable`, `setPosition`.
- [ ] **D.3 Stepper limit switches + homing (Phases 6–7)** — trip event, two-switch op, full SEEK→BACKOFF→TRAVEL, `homeFail`, instant-kill re-zero.
- [ ] **D.4 NeoPixel / Ultrasonic / IMU (Phases 9–11)** — browser-driven paths.
- [ ] **D.5 Sketch-created devices** — servo/stepper/bus-servo/NeoPixel/Ultrasonic/IMU announce + materialisation on R4.
- [ ] **D.6 Bus servos** — as §C, on R4.

---

## E. Serial (USB) transport & listen-and-switch — ✅ confirmed on ESP32 + UNO R4 WiFi (2026-08)

**✅ Confirmed working on ESP32-WROVER and UNO R4 WiFi (2026-08, Scott):** `begin()`
brings up WiFi *and* listens on USB; a `connectSerial()` picker gesture switches the
board to USB (WiFi→USB, one-way); `'usbBusy'` stops a silent port reuse from stealing
a WiFi board; `CMD_REBOOT` gives reset-while-USB auto-recovery. Boot-watch fast-switch,
takeover-during-WiFi-connect, and the config-menu takeover watch were all bench-confirmed
on the R4. **Still open:** R4 Minima (no unit benched), and any specific edge-case items
below not individually exercised (esp. E.7 cable-pull, E.8 NeoPixel byte-loss self-heal).

Original bench order was **ESP32 first** (known rig), then **R4 WiFi** (native USB CDC — the blocking-write risk lives here), then **R4 Minima** (needs a unit — none benched).

- [ ] **E.1 begin(PARDALOTE_SERIAL) [ESP32, R4, R4-M]** — starts serial; on Minima also confirm a plain `begin()` starts serial with the Serial note (and a no-WiFi-form prints the expected error where applicable).
- [ ] **E.2 connectSerial() from Chrome** — picker → `ready`. Granted port reused silently on return; `{prompt:true}` re-shows picker; Chrome/Edge only; baud 115200.
- [ ] **E.3 DTR reset survival [ESP32]** — probe survives the reset on port open; measure ESP32 boot time vs the 500 ms probe cadence.
- [ ] **E.4 `Serial.print` coexistence** — sketch text → `'log'` event in browser, no frame corruption while a servo streams (envelope/COBS resync).
- [ ] **E.5 Reload inside rx-timeout** — reload the page within the 8 s rx-timeout → HELLO-request path re-arms the full sync.
- [ ] **E.6 Unplug/replug USB** — auto-reconnect re-acquires the port (fresh SerialPort via `getPorts()`).
- [ ] **E.7 Cable pull mid-`writeTimed`** — board reaches a hard state after rx-timeout; no runaway; writes into a dead port don't block (heartbeat ping every 3 s).
- [ ] **E.8 NeoPixel `show()` under serial load** — interrupts-off byte loss → CRC drops, link self-heals (one message lost, never the link).

---

## F. Connection key (WS only) — zero bench

- [ ] **F.1 Right key** — `begin("key")` + `connect(ip,{key})` → normal HELLO flow → `ready`.
- [ ] **F.2 Wrong key** — single `'authFail'`, **auto-reconnect disabled** (no retry loop hammering the board).
- [ ] **F.3 No key** — reason-1 reject after ~3 s.
- [ ] **F.4 Mixed clients** — a right-key browser joins while a wrong-key browser is refused; multi-client announce/broadcast still correct with authed + pre-auth clients.

---

## G. Boot id + reconnect provenance — re-run the bug that motivated it

- [ ] **G.1 Firmware swap drops stale share** — firmware A shares `A0`; upload firmware B *without* the share; reconnect → polling **STOPS**, pin-mode not replayed. *(The sweep fixes this even without boot ids.)*
- [ ] **G.2 WiFi blip (same firmware)** — poll must **resume** (re-registered interval reaches the board), state kept.
- [ ] **G.3 Reset, same firmware** — board-shared state comes back via announce.
- [ ] **G.4 `'reboot'` event** — fires on firmware swap (before `'ready'`); board state dropped then repopulated by announce.
- [ ] **G.5 Boot ids differ across boots** — confirm on ESP32 (`esp_random`) **and** UNO R4 (the `micros()`-seeded fallback — the one to watch).

---

## H. Message-channel edge cases (not specifically exercised)

- [ ] **H.1 Retain size cap** — text/blob at the 48 B retain cap → warn+skip beyond, no corruption.
- [ ] **H.2 Large Arduino→JS value** — text/blob near the ~240 B Arduino→JS cap round-trips intact.

---

## I. Camera (browser-only, ESP32-only, HTTP/WiFi) — ✅ confirmed working (Seeed XIAO ESP32S3 Sense, 2026-08)

- [x] **I.1 Stream** — camera-stream example connects over HTTP and shows live frames on ESP32; behaves independently of the WebSocket/serial control channel (camera stays WiFi-only). *(No sketch-attach path by design.)* **✅ Confirmed on the XIAO ESP32S3 Sense (2026-08) — see the results log below.**

---

### Priority for remaining bench coverage (post-1.0.0 — shipped 2026-08-14)
Confirmed since this list was written: **§E** serial + listen-and-switch (ESP32 + R4 WiFi), **§C** ST/STS bus servos, **§I** camera. Still open:
1. **§A** regression on both boards (re-run after any firmware/JS change).
2. **§B** ESP32 open items (fastest — the rig exists): 6.2–6.4, 7.4, Phase 8, 9.3/10.2/11.3–11.4.
3. **§F / §G** — connection key, boot-id provenance (still zero-bench).
4. **§D** the whole R4 extension surface; **§C.4** SC-series bus servos; sketch-created devices.
5. **§E** R4 Minima (needs a unit).

---

## Bench-test results — full hardware log

_Moved from PROJECT-STATUS.md (2026-08). The checklist above is *what to test*; this is *what has been confirmed on hardware*._

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
  (`share(A0, ANALOG_INPUT_MODE)` auto-poll). *(ESP32 gotcha found: analog input must
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

### 🧪 Full bench-test log — ESP32-WROVER (2026-07, Phases 0–11)

The per-test run behind the summary above. ✅ = passed on hardware, ⬜ = not
yet done / untested. This is the **authoritative granular record** and
supersedes the earlier "zero bench time" labels still scattered below for the
features it covers (messaging, sketch-created servo, limit switches, homing,
NeoPixel, ultrasonic, IMU). Two earlier summary lines were optimistic — see the
⚠️ corrections at 4.4 and 6.2/6.3.

**Phase 0 — Transport & handshake** *(basic-LED sketch + `basic-LED-example/`)*
- ✅ 0.1 Board joins WiFi; IP prints on Serial @115200.
- ✅ 0.2 Browser fires `connect` then `ready`; `arduino.board` sensible, `arduino.analogMax === 4095` (HELLO carries ESP32 ADC range).
- ✅ 0.3 Power-pull → browser logs reconnect attempts and auto-reconnects on return (exponential backoff, no reload).
- ✅ 0.4 Second tab also reaches `ready` and sees live state (multi-client sync).

**Phase 1 — Pins (digital out/in, analog in)** *(basic-LED + `shared-control-example/` + `shared-input-example/`)*
- ✅ 1.1 `digitalWrite(2, HIGH/LOW)` toggles the LED.
- ✅ 1.2 Physical button → LED + browser mirror stays synced (`Pardalote.send` echo); browser button flips it back. Last-writer-wins, both voices.
- ✅ 1.3 Sketch `share(A0, ANALOG_INPUT_MODE)` (pot on GPIO 36) → browser gets values via `onChange('A0', …)` with no JS setup; auto-poll starts, values span ~0–4095.

**Phase 2 — Messaging channel** *(messaging example + `messaging-example/` inspector — previously zero bench time)*
- ✅ 2.1 Browser `send('led', bool)` → sketch `watch("led")` drives the LED (browser→sketch, bool).
- ✅ 2.2 Sketch retained `"uptime"` once/sec → browser `messages['uptime']` updates (sketch→browser, int).
- ✅ 2.3 (retain) Reload mid-stream → late client immediately gets the current value in the pre-`ready` sync (not zero, no wait).
- ✅ 2.4 (broadcast) Two browsers: tab A `send('cursor', 120, {broadcast:true})` → tab B sees it, tab A gets no self-echo, sketch still sees it.
- ✅ 2.5 (frame monitor) `monitor(fn)` / inspector shows name-decoded traffic (MESSAGE, DIGITAL_WRITE, …) with no visible perf hit while a servo/pot also streams.

**Phase 3 — Servo (PWM, browser-driven)** *(servo example + `servo-example/`, signal on GPIO 18)*
- ✅ 3.1 `attach(18)`, `write(0/90/180)` — centre/min/max land correctly.
- ✅ 3.2 `writeTimed(120, 1500)` interpolates smoothly on-board; `whenDone()` resolves on arrival. 20 ms tick feel fine under WiFi load.
- ✅ 3.3 Immediate `write()` cancels an in-progress timed move (and `sweep()`).
- ✅ 3.4 (soft limits) `setLimits(20,160)` → commands 0/180 clamp to 20/160; browser cached angle matches the clamp.
- ✅ 3.5 (home) `setHome(45)` then `home(1000)` eases to 45°; bare `home()` snaps there.

**Phase 4 — Sketch-created servo** *(shared servo sketch + `shared-servo-example/` — previously zero bench time)*
- ✅ 4.1 (late browser) Board attaches first → connect browser → `arduino.pan` exists at `ready` with correct pin/angle; `'share'` fires before `'ready'`.
- ✅ 4.2 (mid-loop attach) Browser already connected, sketch attaches → `arduino.pan` appears live.
- ✅ 4.3 (reconnect after reset) Reset board → servo re-materialises in the open browser after auto-reconnect.
- ⬜ 4.4 (idempotent) `attach("pan", 18)` twice → one servo, not two. **⚠️ Not yet exercised** — the "all four materialisation cases" claim in the summary above was optimistic; treat idempotent as still-to-confirm.
- ⬜ 4.5 Confirm the UNO R4 caveat is moot on the ESP32 path (compiled & ran on ESP32; UNO R4 path not run here).

**Phase 5 — Stepper: basic motion** *(stepper example + `stepper-example/`, STEP/DIR/EN → 25/26/27)*
- ✅ 5.1 `attach(25,26,27)`, `setMaxSpeed`/`setAcceleration`, `moveTo(2000)` clean accel-limited move; `whenDone()` resolves at target.
- ✅ 5.2 `moveToTimed(3200, 2000)` arrives in ~2 s, constant speed, no stall.
- ✅ 5.3 `runSpeed(±600)` spins continuously; `stop()` decelerates.
- ✅ 5.4 `read(100)` polls; position advances, `target`/`distanceToGo`/`isRunning` sane; `setPosition(0)` re-zeros.
- ✅ 5.5 `enable()`/`disable()` hold vs free-by-hand.

**Phase 6 — Stepper limit switches** *(switch → GPIO 32 → GND, MIN, active-LOW — previously zero bench time)*
- ✅ 6.1 `setLimitSwitch(LIMIT_MIN, 32)`; drive toward it → instant board-side stop (no WiFi round-trip, no decel ramp); browser gets `'limit'` + `limitHit === 'min'`.
- ⬜ 6.2 (direction-aware guard) Move away from a pressed switch is allowed, no false trip. **⚠️ Not done — "not sure what this is."** Also unconfirmed in the summary above; still open. *(How to test: hold the switch pressed, command a move in the release direction; it should run instead of re-tripping — this exercises the `speed()`-sign / `distanceToGo` fallback.)*
- ⬜ 6.3 (release debounce) 20 ms release debounce → no LIMIT-frame spam, and the normal `done` follows so `whenDone()` settles. **Not done — "not sure how to test this."** *(How to test: trip then slowly release; watch the frame monitor for a single clean LIMIT then DONE, not a burst.)*
- ⬜ 6.4 (trip latency under load) Trip while `read()` polling + something else streams.
- ✅ 6.5 Added a MAX switch on GPIO 33 → two-switch operation works.

**Phase 7 — Stepper homing** *(SEEK→BACKOFF→TRAVEL, MIN switch on GPIO 32 — previously zero bench time)*
- Observations worth flagging: stepper visual **moves after board disconnect**; and a **4-wire stepper can't run backwards** (possibly the specific motor — needs a second unit to confirm).
- ✅ 7.1 `setLimitSwitch(LIMIT_MIN, 32)`, `setHome(800)`, `home()` → seeks switch, counter → 0 at trip, backs off until released, accel-travels to 800, fires `done`; `whenDone({timeout:30000})` resolves `true`.
- ✅ 7.2 (back-off release point) Back-off clears the switch before TRAVEL (the drift case PROJECT-STATUS flagged didn't bite).
- ✅ 7.3 (home from already-pressed) Starting with the switch pressed → backs off first, then seeks/travels correctly.
- ⬜ 7.4 (setSpeed survives) `home({speed:400})` seek speed honoured and maxSpeed cap restored for the TRAVEL leg.
- ✅ 7.5 (timeout / homeFail) Unplugged switch → after the ~30 s cap the board hard-stops, fires `'homeFail'`, then `done`. Nothing spins forever.
- ✅ 7.6 (instant-kill re-zero) After a trip, `setPosition(currentPosition())` acts as an instant kill in POSITION/VELOCITY/TIMED.

**Phase 8 — Sketch-created stepper** — ⬜ not done (whole phase; `PardaloteStepper.attach("base", 25,26,27)` + four materialisation cases, `attach4wire`).

**Phase 9 — NeoPixel** *(neopixel example + `neopixel-example/`, data on GPIO 4)*
- ✅ 9.1 `init(4, N)`, `setPixelColor`/`fill`/`show`, `setBrightness`, `clear` — colours correct.
- ✅ 9.2 `show()` debounce: fast animation coalesces without lag.
- ⬜ 9.3 (sketch-created, zero bench) `PardaloteNeoPixel.attach(...)` + `fill`/`show` in the sketch → four materialisation cases; late browser sees current colours via announce.

**Phase 10 — Ultrasonic** *(ultrasonic example + `ultrasonic-sensor-example/`, Trig 13 / Echo 14 divided to 3.3V)*
- ✅ 10.1 `attach(13,14)`, `read(200, CM)` returns plausible cm, tracks a moving target, out-of-range returns -1.
- ⬜ 10.2 (sketch-created, zero bench) `PardaloteUltrasonic.attach(...)` + sketch `read()` alongside the browser poll; four materialisation cases.

**Phase 11 — IMU** *(imu example + `imu-example/`, I2C SDA 21 / SCL 22)*
- ✅ 11.1 `attach(0x68)` identifies (WHO_AM_I); `read(20)` streams sane accel (~1g down axis) and gyro (~0 at rest).
- ✅ 11.2 `calibrate(200)` flat, Z up → accel.z ≈ +1g, gyro ≈ 0; offsets survive a browser reload (re-sent on reconnect).
- ⬜ 11.3 `setAccelRange` / `setGyroRange` change scaling as expected.
- ⬜ 11.4 (sketch-created, zero bench) `PardaloteIMU.attach("imu","6050")` identifies, sketch `read()` sane, model-payload attach round-trips to the browser; four materialisation cases.

**Still open on ESP32 after this run:** 4.4–4.5, 6.2–6.4, 7.4, Phase 8 (all),
9.3, 10.2, 11.3–11.4 — plus the two Phase 7 observations (move-after-disconnect,
4-wire reverse).

### ✅ Confirmed on hardware (2026-07, UNO R4 WiFi — first UNO R4 bench time)
- **Core transport on UNO R4** — WiFi connect, HELLO handshake, WebSocket server
  (WiFiS3 + arduinoWebSockets), sustained multi-message throughput, and
  auto-reconnect all work.
- **PWM (`analogWrite`)** — slider-driven writes run smoothly at the default 20 ms
  write throttle *once the loop is kept responsive* (see the UNO R4 WebSocket fix
  below — the LED matrix was starving it).
- **LED matrix** — boot "Pardalote" + IP scroll, plus the new stop-on-connect
  behaviour.
- Still unverified on UNO R4: the extension/actuator paths (servo, stepper,
  bus servo, NeoPixel, ultrasonic, IMU, camera) and sketch-created devices.
  (Core pins — digital in/out + analog in — and the whole messaging channel are
  now confirmed too; see the UNO R4 bench log just below.)

### 🧪 UNO R4 bench-test log (2026-07, Phases 0–2)

Same phase plan as the ESP32 run, on the UNO R4 WiFi. ✅ = passed. (The plan text
was copied from the ESP32 sheet; board-specific values below are the corrected
UNO R4 ones, confirmed with Scott.)

**Phase 0 — Transport & handshake** *(basic-LED sketch + `basic-LED-example/`)*
- ✅ 0.1 Board joins WiFi; IP prints on Serial @115200.
- ✅ 0.2 Browser fires `connect` then `ready`; `arduino.board` sensible; HELLO carries the ADC range — `arduino.analogMax === 1023` (10-bit) on the R4, matching the pin-capabilities doc.
- ✅ 0.3 Power-pull → browser logs reconnect attempts and auto-reconnects on return (exponential backoff, no reload).
- ✅ 0.4 Second tab also reaches `ready` and sees live state (multi-client sync).

**Phase 1 — Pins (digital out/in, analog in)** *(basic-LED + `shared-control-example/` + `shared-input-example/`)*
- ✅ 1.1 `digitalWrite(2, HIGH/LOW)` toggles the LED.
- ✅ 1.2 Physical button → LED + browser mirror stays synced (`Pardalote.send` echo); browser button flips it back. Last-writer-wins, both voices.
- ✅ 1.3 Sketch `share(A0, ANALOG_INPUT_MODE)` (pot on **A0** = pin 14 on the R4) → browser gets values via `onChange('A0', …)` with no JS setup; auto-poll starts, values span ~0–1023.

**Phase 2 — Messaging channel** *(messaging example + `messaging-example/` inspector)*
- ✅ 2.1 Browser `send('led', bool)` → sketch `watch("led")` drives the LED (browser→sketch, bool).
- ✅ 2.2 Sketch retained `"uptime"` once/sec → browser `messages['uptime']` updates (sketch→browser, int).
- ✅ 2.3 (retain) Reload mid-stream → late client immediately gets the current value in the pre-`ready` sync.
- ✅ 2.4 (broadcast) Two browsers: tab A `send('cursor', 120, {broadcast:true})` → tab B sees it, tab A gets no self-echo, sketch still sees it.
- ✅ 2.5 (frame monitor) `monitor(fn)` / inspector shows name-decoded traffic with no visible perf hit while a pot/servo also streams.

**Still to run on UNO R4:** Phases 3–11 (servo, stepper, limit switches, homing,
sketch-created devices, NeoPixel, ultrasonic, IMU) — the whole extension/actuator
surface, matching the ESP32 coverage.


### ✅ Bus servos confirmed on hardware (2026-08 — UNO R4 WiFi, ESP32-WROVER, FireBeetle 2 ESP32-C5)
First bus-servo bench time on any board — the ST/STS path is now real hardware-
confirmed, not just structural, across **three boards and both transports**:

| Board | WiFi | USB (serial) | Bus UART |
|---|---|---|---|
| UNO R4 WiFi | ✅ | ✅ | fixed Serial1 = D0/D1 |
| ESP32-WROVER-DEV | ✅ | ✅ | `configureBus` custom pins |
| FireBeetle 2 ESP32-C5 | ✅ | — | `configureBus` custom pins (RX=12, TX=11) |

Exercised via the **bus-servos** and **leader-follower** examples
(`PardaloteBusServo`, ST/STS series, 1 Mbps): attach → servos `[found]`, live
`read()` position streaming, browser-driven writes, group SyncWrite, and the
`CMD_BUSSERVO_ATTACH`/`READ`/`WRITE`/`READ_LIMITS`/`PRESENT` frames. Confirms
`PLATFORM_ESP32` + custom-pin `Serial1.begin(baud, SERIAL_8N1, rx, tx)` on both
the WROVER and the new C5 core. **Also the first confirmation of bus servos over
the USB serial transport** (previously zero bench time) — including the UNO R4's
native-USB CDC path. The `IOTimeOut`/range-clamp **robustness fixes (loose end
0)** are now **landed** (2026-08) — the WiFi/JS hang when a servo *stops*
answering (unplugged, faulted, or driver-board power loss) is fixed in firmware;
**needs a re-upload to confirm on the bench.** Still open on bus servos:
**SC-series**, `done`-poll timing edges, and sketch-created bus servos.

### ✅ Camera confirmed on hardware (2026-08 — Seeed XIAO ESP32S3 Sense)
**First camera bench time on any board** — the MJPEG-stream + snapshot path
(`PardaloteCamera.h` + `camera.js`, `DEVICE_CAMERA 204`, `CMD_CAMERA_INIT/
SET_RES/SET_QUALITY 0x30–0x32`) is now real-hardware-confirmed on the XIAO
ESP32S3 over WiFi (camera is WiFi-only — the HTTP server is separate from the
WebSocket). Confirmed working: `attach(82)` → HTTP server + live MJPEG stream in
the browser, `setResolution()` **both before and after `attach()`** (see the fix
below), quality changes, and resolution surviving a reconnect.

**The gotcha that ate the first session — enable OPI PSRAM.** The XIAO ESP32S3
(an ESP32-**S3R8**) has 8 MB of *octal* PSRAM, but the Arduino IDE defaults can
leave `psramFound()` returning false. Symptom chain: Serial prints
`[Camera] No PSRAM — using DRAM, forced to QQVGA`, the camera is pinned to QQVGA
in DRAM, and any resolution change spams `cam_hal: FB-OVF` (the larger frame
can't fit the single DRAM buffer) with a broken stream. **Fix: Tools → PSRAM →
`OPI PSRAM`** (not "QSPI PSRAM", not Disabled). With PSRAM up, the init takes the
`fb_count = 2` / `CAMERA_FB_IN_PSRAM` branch and resolution changes work. Now
documented in `troubleshooting.md` + `camera.md`.

**Three fixes landed + bench-verified this session:**
- **`setResolution()`/`setQuality()` before `attach()` now works.** The board
  reliably changes frame size only via the post-init `set_framesize()` path, so
  `camera.js` `_sendInit()` now **replays** the desired framesize + quality right
  after `CMD_CAMERA_INIT`. This makes the documented "call before or after
  attach()" true, and — bonus — keeps resolution/quality in sync **across a
  reconnect** (a reconnect re-inits the board at its defaults; the replay
  re-applies the JS-side state). Verified on the bench.
- **No-PSRAM set-res guard.** When the camera comes up in the DRAM/QQVGA
  fallback (`_dramFallback`), `CMD_CAMERA_SET_RES` is refused with a clear
  Serial line instead of guaranteeing FB-OVF. (Belt-and-braces — a working XIAO
  never enters this path once OPI PSRAM is on.)
- **Stream survives a dropped frame.** `_streamHandler` now skips up to 4
  consecutive failed captures and only closes on the 5th, so a *transient*
  FB-OVF (e.g. requesting `FRAMESIZE_HD`, which pushes the OV2640 too hard) no
  longer tears down the HTTP connection with `ERR_INCOMPLETE_CHUNKED_ENCODING`.
  **HD deliberately left available, not clamped** (Scott's call) — it works on
  some sensors; the example README + `camera.md` note that it may FB-OVF on the
  XIAO and to step down to **`FRAMESIZE_SVGA` (800×600)**, the reliable ceiling
  here. A size that overflows *every* frame is the sensor's limit, not a bug.

Still open on the camera: **sketch-created camera is deliberately not built**
(singleton, ESP32-only — see the sketch-attach note below); other camera boards
(WROVER-KIT, AI-Thinker, etc.) remain structural-only.

**Still to confirm on real hardware** (items above are done; these remain — see the
Phase 0–11 bench log for what the 2026-07 ESP32 run already cleared):
- **Serial transport** (newest, zero bench time): `begin(PARDALOTE_SERIAL)` on
  ESP32 + R4 WiFi and on an **R4 Minima** (needs a Minima — none benched yet;
  also confirm a plain `begin()` on the Minima prints the no-WiFi error); `connectSerial()` from Chrome → picker → ready; probe survives
  the DTR reset on port open (ESP32 resets, watch how long boot takes vs the
  500 ms probe); `Serial.print` from the sketch → `'log'` event, no frame
  corruption while a servo streams; reload the page inside the 8 s rx-timeout
  (HELLO-request path); unplug/replug USB → auto-reconnect re-acquires the
  port; pull the cable mid-`writeTimed` → board hard state after rx-timeout;
  NeoPixel `show()` under serial load (interrupts-off byte loss → CRC drops,
  should self-heal). Bench order suggestion: ESP32 first (it's the known rig),
  then R4 WiFi (native USB CDC — the blocking-write risk lives here).
- **Connection key** (zero bench time): `begin("key")` + right key → ready;
  wrong key → single `'authFail'`, no reconnect churn in the console; no key →
  reason-1 reject after ~3 s; second browser with the right key joins while a
  wrong-key browser is refused; multi-client announce/broadcast still correct
  with a mix of authed + pre-auth clients.
- **Boot id + reconnect provenance** (newest, zero bench time): re-run the
  bench scenario that found the bug — share `A0` from firmware A, upload
  firmware B without the share, reconnect → polling must STOP and the
  pin-mode must not be replayed. Also: WiFi blip with the board running
  (poll must resume — the re-registered interval reaches the board),
  reset button with the SAME firmware (share must come back via announce),
  `'reboot'` event fires on firmware swap, and boot ids actually differ
  across consecutive boots on both ESP32 (`esp_random`) and UNO R4 (the
  `micros()`-seeded fallback — the one to watch).
- **Stepper homing** — **mostly confirmed on ESP32 (2026-07):** SEEK→BACKOFF→TRAVEL
  end-to-end, clean trip + switch-coordinate adopt, back-off releases before TRAVEL,
  homing from an already-pressed switch, `homeFail` on timeout, and the instant-kill
  re-zero (Phases 7.1–7.3, 7.5–7.6). **Still open:** 7.4 — confirm `home({speed})`
  seek speed is honoured and the maxSpeed cap is restored for the TRAVEL leg
  (`setSpeed()` surviving the between-legs restore). Also flagged during the run:
  stepper visual moves after board disconnect, and a 4-wire stepper wouldn't run in
  reverse (possibly the motor — needs a second unit).
- **Stepper limit switches** — **partly confirmed on ESP32 (2026-07):** board-side
  instant trip + `'limit'`/`limitHit` event (6.1) and two-switch MIN+MAX operation
  (6.5). **Still open:** the direction-aware guard (6.2 — no trip when backing off a
  pressed switch, the `speed()`-sign / `distanceToGo` fallback), the 20 ms release
  debounce on a real switch (6.3), and trip latency under WiFi + poll load (6.4). The
  instant-kill `setCurrentPosition(currentPosition())` across POSITION/VELOCITY/TIMED
  is confirmed (7.6).
- **SCServo library method names**, especially `ReadMove` on the **`SCSCL` (SC)
  class** — least certain. Also `WritePosEx`, `SyncWritePosEx`, `CalibrationOfs`,
  `unLockEprom`/`writeByte`, and the ID register constants (`SMS_STS_ID` /
  `SCSCL_ID`). The **ST/STS3215 path is the primary one**; SC is coded but least sure.
- **AccelStepper**: `runSpeedToPosition()` for timed moves is **confirmed** (`moveToTimed`
  arrived on time, Phase 5.2); the remaining piece is that `setSpeed()` is clamped to
  `maxSpeed()` across the timed-move cap raise/restore — same open item as homing 7.4.
- **Servo interpolator**: the 20 ms tick feel under WiFi load — **confirmed on ESP32**
  (smooth, no jitter, Phase 3.2).
- **Bus-servo `done`**: the board polls the `Moving` flag (~30 Hz); confirm no
  false `done` at t=0 (there's a 40 ms startup guard) and that long moves aren't
  cut short (no-response watchdog, not a fixed timeout).
- **Sketch-created servos** — **mostly confirmed on ESP32 (2026-07):** late-browser
  announce (`arduino.pan` at `'ready'`, `'share'` before `'ready'`), mid-loop attach
  live, and reconnect-after-reset re-materialisation all pass (Phases 4.1–4.3).
  **Still open:** 4.4 idempotent re-attach by name (attach twice → one servo — was
  claimed in the summary but not actually exercised), and 4.5 the UNO R4 path (only
  the ESP32 path was run; host stub-compile covered ESP32 defines only).
- **Sketch-created steppers & bus servos** (still zero bench time — Phase 8 not run):
  same materialisation path as sketch-created servos, extended to the
  other two actuators (`PardaloteStepper.attach("base", 2, 3, 4)` /
  `attach4wire`, `PardaloteBusServo.attach("wrist", 5)`). Confirm the
  same four cases (mid-loop attach live, late-browser announce replay,
  reconnect after reset, idempotent re-attach by name), plus that the
  bus-servo attach brings the shared UART up correctly and its return
  value (the logical id) feeds `write`/`read` as expected.
  Stub-compile covered the ESP32 path only — confirm UNO R4 compiles.
- **NeoPixel / Ultrasonic / IMU** — the **browser-driven** paths are now **confirmed
  on ESP32 (2026-07):** NeoPixel init/`fill`/`show`/brightness + show-debounce
  (9.1–9.2), Ultrasonic `attach`/`read(CM)` tracking + out-of-range −1 (10.1), IMU
  `attach(0x68)` WHO_AM_I identify, `read()` sane accel/gyro, and `calibrate()` with
  offsets surviving reload (11.1–11.2). **Still open:** IMU `setAccelRange`/
  `setGyroRange` scaling (11.3); and the **sketch-created** variant of all three —
  `PardaloteNeoPixel/Ultrasonic/IMU.attach(...)` + the four materialisation cases,
  late-browser announce, and the IMU model-payload round-trip (9.3, 10.2, 11.4 — zero
  bench, ESP32 stub-compile only).
- **Message channel** — **confirmed on ESP32 and UNO R4 (2026-07, Phase 2):** browser→sketch
  `watch` fires with the right type (bool), sketch→browser retained `send` updates
  `messages[...]` (int), `retain` replays to a late-reloading browser in the
  pre-`ready` sync, `broadcast` reaches a second browser (no self-echo) and the
  sketch, and the frame monitor shows name-decoded traffic with no perf hit while a
  pot/servo streams. **Remaining edge cases (not specifically exercised):** text/blob
  at the retain 48 B cap (warn+skip beyond) and a text/blob near the ~240 B Arduino→JS
  cap.

---


---

## Bugs found & fixed on the bench

_Root-cause + fix write-ups for issues surfaced and verified on real hardware (moved from PROJECT-STATUS.md, 2026-08)._

### 🔧 Fixed + bench-verified this session (UNO R4 WebSocket / PWM lag)
Scott's first UNO R4 bench test surfaced a PWM problem: dragging an `analogWrite()`
slider built a growing send queue, latency climbed with movement, and a long
enough queue dropped the WebSocket (reconnect churn). ESP32 hid it entirely.
Root-caused in order:

- **Root cause was loop starvation — NOT throughput, and NOT Nagle.** The UNO R4's
  WiFiS3 WebSocket stack destabilises when `loop()` is blocked: `webSocket.loop()`
  must be serviced promptly or the connection stalls and drops. Confirmed by Scott —
  a bare `delay(100)` in `loop()` reproduces it (cf. [arduinoWebSockets #909](https://github.com/Links2004/arduinoWebSockets/issues/909)).
  An early delayed-ACK/Nagle hypothesis (from a ~200 ms symptom) was **wrong**: the
  200 ms was the LED-matrix rebuild cadence stealing loop time, not a TCP timer.
- **The blocker was the LED matrix.** `ledMatrixLoop()` re-armed and replayed the IP
  scroll *forever*, doing that rebuild work every cycle. **Fix:** signature is now
  `ledMatrixLoop(bool anyConnected)` — it stops re-arming once a browser connects (the
  in-flight `SCROLL_LEFT` runs off-screen and leaves the matrix blank, so nothing to
  clear); scrolling resumes if every client disconnects, so the IP stays readable for
  the next connection. With the scroll gone, `analogWrite` runs fine at 20 ms.
  (`internal/led_matrix.{h,cpp}`, `Pardalote.cpp::_platformLoop`.)
- **Defensive PWM throttle added (JS).** Core `analogWrite()` is now rate-limited per
  pin — leading write immediate, rapid follow-ups coalesced into one trailing send
  carrying the final value (mirrors the servo/neopixel throttle; preserves the
  documented "individual writes flush immediately" feel). New `arduino.setWriteThrottle(ms)`
  / `setWriteThreshold(v)`, default 20 ms / 0, `0` = off. Caps a slider's per-loop parse
  load; imperceptible on ESP32. (`pardalote-js/pardalote.js`.) Verified with a
  fake-timer Node harness: a 25-write burst → leading + final value always delivered,
  coalesced in between; throttle=0 sends all; threshold suppression and per-pin
  independence check out. Pending PWM sends are cancelled on (re)connect so a value
  queued for the old board never lands on a new one.
- **Dropped: killing Nagle (`setNoDelay`).** Wrong layer — it governs outbound TCP
  segmentation, not loop-servicing cadence, so it can't fix delay-induced instability.
  Left un-pursued since the 20 ms default now works.
- **Docs.** Troubleshooting rewritten to "WebSocket is unstable on the UNO R4 — keep
  `loop()` tight" (cites #909, notes PWM lag as an *indirect* symptom); the
  `analogWrite()` reference documents the throttle + the two new setters. HTML
  regenerated via `build_reference.py`.
- **Noted for later (not done):** [NuSock](https://github.com/mobizt/NuSock) (mobizt) is
  a more R4-hardened WebSocket library (zero-interrupt UART locking, duplicate-handle
  cleanup, WSS, fragmentation), but on the R4 it still runs cooperatively polled in
  "Generic mode" — it would harden connection churn, not remove the keep-`loop()`-tight
  rule (that's inherent to the RA4M1 + WiFiS3 modem architecture; async/lwIP libs like
  ESPAsyncWebServer don't work on R4). Not a drop-in (different event model from
  `WStype_*`). Open option: prototype it behind Pardalote's `_ws` abstraction to
  bench-compare. Also open: a short "don't block the loop" note in the Arduino README.

Both firmware TUs stub-compiled clean on `-DARDUINO_UNOR4_WIFI` and `-DESP32`. (The
leftover `/tmp` matrix stub was too thin for the animation API and needed fleshing out,
plus two stub-fidelity fixes — `constrain` should be a macro, `IPAddress` needs
`operator[]` — neither a change to firmware.)

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

**Still unverified on hardware** — SC-series, sketch-created
stepper/busservo/NeoPixel/Ultrasonic/IMU, and the UNO R4 extension/actuator paths for
everything EXCEPT bus servos (UNO R4 core transport, PWM, and now **bus servos**
are confirmed — servo/stepper/NeoPixel/ultrasonic/IMU on the R4 remain open).
(Browser-driven servo, stepper, NeoPixel, ultrasonic, IMU and the
whole messaging channel are now **confirmed on ESP32** — see the Phase 0–11 bench
log above. **Bus servos are now confirmed on UNO R4, ESP32-WROVER and ESP32-C5,
over WiFi and USB**, and **the camera is now confirmed on the XIAO ESP32S3** —
see the two entries just below.)
Details:


0b. **✅ DONE + bench-confirmed (2026-08) — Bus-servo LOST-servo poll back-off.**
   Follows the loose-end-0 IOTimeOut work. A power brownout under load (Scott's was
   a loose servo-power connector) makes all bus servos stop answering at once; each
   periodic read then blocks up to `IOTimeOut` (5 ms) in `FeedBack()`, and the poll
   loop reads every due servo per `loop()` pass — so ~6 dead servos ≈ 30 ms of
   blocking per pass, sustained through the outage. On the **UNO R4** that starved
   the WiFiS3 / native-USB transport and dropped the connection (WiFi *and* USB);
   **ESP32 rode it out** (headroom + FreeRTOS yield) — so this was R4-specific
   transport fragility, servo loss itself being a hardware/power issue.
   **Fix (`PardaloteBusServo.h`):** per-servo back-off — a read returning −1 sets
   `_lostRetryAt[id] = now + BUSSERVO_LOST_RETRY_MS` (500 ms) and further reads of
   that servo are skipped until then, so a dead servo is polled ~2 Hz instead of
   every pass. Responding servos (`_found == 1`) are never throttled → zero effect
   on normal poll rate / relay latency; only cost is LOST→found recovery noticed up
   to 500 ms later (tunable). **Bench-confirmed on BOTH UNO R4 and ESP32 (2026-08,
   Scott): no loss of WiFi or USB through a servo power dropout, and servos
   reconnect when power is restored.** Deliberately back-off ONLY (not the per-loop
   read cap — would add relay-latency read-spread on the R4; see 0c). See
   [[busservo-lost-backoff]].


0. **✅ DONE (2026-08) — Bus-servo robustness, two fixes.** Root cause found on
   a UNO R4 bench session, then confirmed to bite **any WebSocket board, not
   just the R4**. When a bus servo stops answering — wires jostled loose by a
   violent move, a servo stalled/faulted at a firmware limit, physically
   unplugged, or the driver board losing power (Scott's report: servo-board
   power drop takes the WiFi/JS link down on both FireBeetle C5 and
   ESP32-WROVER) — the SCServo library's blocking read (`SCSerial::readSCS`,
   `IOTimeOut = 100` ms) stalls `loop()` for ~100 ms per failed transaction (up
   to ~300–400 ms with line noise), ×N polled servos (~600 ms for six). That
   starves `_ws.loop()`: on **ESP32** the WebSocket drops (WS is serviced in
   `run()` → `_ws.loop()` before `loopAll()`); on the **UNO R4** it's *exactly*
   the documented `delay(100)` WiFiS3 killer (see the "UNO R4 WebSocket / PWM
   lag" entry + arduinoWebSockets #909). Either way the board looks hung — no
   reboot banner, no serial msg, browser can't reconnect. **Confirmed on the
   bench** by pulling TX/RX/GND live and by servo-board power loss. This unifies
   the earlier "board resets near a firmware limit" and "resets on a wild swing"
   reports — it's not power to the *host* and not a crash; it's a starved loop.
   Two fixes, both now landed:
   - **(a) ✅ Shrunk `IOTimeOut` to 5 ms.** `IOTimeOut` is a public member of
     `SCSerial`, inherited by `_st`/`_sc`; set `_st.IOTimeOut = _sc.IOTimeOut =
     5` in `ensureBus()` (`PardaloteBusServo.h`) — no library edit. A servo at
     1 Mbps answers in well under 1 ms, so 5 ms is a big margin; the shorter
     timeout only affects the *failure* path (good reads return as soon as the
     bytes arrive), capping a fully-silent six-servo poll at ~30 ms instead of
     ~600 ms and keeping `loop()` tight. Bus-servo analogue of the
     `Wire.setTimeOut(50)` I2C fix already in the code. **Needs a re-upload to
     each board.**
   - **(b) ✅ Range-clamp commanded position, firmware + JS.** An out-of-range
     count wraps mod-resolution and swings the servo the wrong way. Firmware:
     `writePos()` now `constrain(pos, 0, isSC?1023:4095)` (the choke-point for
     browser write, sketch write, and gesture), the SyncWrite handler clamps
     its own `positions[]` (it bypasses `writePos`), and `echoTarget()` mirrors
     the clamp so the browser caches the value the board actually applied. JS:
     `busServo.js` `_clampPos()` now always clamps to `[0, resolution-1]` before
     soft limits — the single choke-point for `write`/`writeTimed`/`_member*`/
     gesture, so the amber needle, `whenDone` timing, and group speed-matching
     stay honest. Firmware clamp is the hardware safety net (covers non-browser
     sources); JS clamp keeps the browser's model truthful. **Firmware side
     needs a re-upload.**
   - **Done earlier (2026-08):** the *example* overflow that provoked this
     (bus-servos dial `atan2()+HALF_PI` fed to an unclamped `map(…,-PI,PI,…)`,
     overshooting to ~5120) was already fixed — the mouse→counts result is
     wrapped into `[0, resolution)`. (a)/(b) are the defence-in-depth on top.
   - **Strategic framing (Scott's call, 2026-08):** don't chase R4-WiFi
     bulletproofing forever — the RA4M1 + WiFiS3 "keep `loop()` tight" rule is
     architectural. The blocking surface is finite (I2C ✅, bus-servo UART ← (a),
     ultrasonic `pulseIn` — audit, stray `delay()` ✅); close those, then steer
     heavy/wireless actuator work to **ESP32** (proven on the bench) or run the
     **R4 over USB serial** (already built — no WiFiS3, so a blocked loop only
     slows, never drops). Position the R4 as "light wireless, or rock-solid over
     USB." Consider a short "don't block the loop / new blocking peripherals
     need a bounded timeout" note in the Arduino README.

