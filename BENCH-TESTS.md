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

## C. Bus servos (all — zero bench, ST/STS primary, SC least certain)

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

## E. Serial (USB) transport — newest, zero bench

Bench order: **ESP32 first** (known rig), then **R4 WiFi** (native USB CDC — the blocking-write risk lives here), then **R4 Minima** (needs a unit — none benched).

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

## I. Camera (browser-only, ESP32-only, HTTP/WiFi) — zero bench

- [ ] **I.1 Stream** — camera-stream example connects over HTTP and shows live frames on ESP32; behaves independently of the WebSocket/serial control channel (camera stays WiFi-only). *(No sketch-attach path by design.)*

---

### Priority for closing out 1.0.0
1. **§A** regression on both boards.
2. **§B** ESP32 open items (fastest — the rig exists): 6.2–6.4, 7.4, Phase 8, 9.3/10.2/11.3–11.4.
3. **§E / §F / §G** — serial, key, boot-id (all zero-bench, highest-risk-because-unrun).
4. **§C** bus servos and **§D** the whole R4 extension surface.
5. **§I** camera.
