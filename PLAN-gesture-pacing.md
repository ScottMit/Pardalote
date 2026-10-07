# PLAN — one gesture pacing policy for every actuator

**Status:** IMPLEMENTED 2026-10-05 — firmware stub-clean on ESP32 / R4 WiFi / Minima,
JS verified on the built bundle (Node, 21 checks), docs + CHANGELOG updated. **Bench
pending** (plan below). Policy agreed 2026-10-01 (Scott); all questions resolved (Q1–Q4).

Implementation notes (2026-10-05):
- Constants in `defs.h`: `GESTURE_LAND_TIMEOUT_MS` 2000, `GESTURE_LAND_CATCHUP_MS` 500,
  `DONE_ARRIVED` / `DONE_GAVE_UP`; protocol MINOR 2 → 3.
- Landing speed (stepper + bus servo): close the remaining gap in ~500 ms, never slower
  than the final segment's average, capped by the type's existing ceiling (stepper: the
  gesture's raised max speed; bus servo: hardware max 4095).
- The outcome is an OPTIONAL third DONE param, sent only on gesture completion. Plain
  moves, homing and older firmware send two params, which JS reads as arrived.
- Bus servo: arrival = within `BUS_ARRIVE_TOL` (20 counts), checked every 33 ms while
  landing; give-up holds by commanding the last read position. Reads during a gesture:
  one per segment boundary + landing checks (skipped for a LOST servo). The pace-gate,
  cohort barrier and their state were removed.
- JS `whenDone()` (actuators + groups) resolves `false` on gave-up or safety timeout;
  `'done'` carries `arrived`. Board-side `onGestureDone(cb)` signature is unchanged — the
  outcome isn't exposed to sketches yet (follow-up if wanted). **Delete this file once fully executed** (repo convention).

## Why

Gesture playback currently treats a lagging actuator three different ways:

| Type | Today |
|---|---|
| PWM servo | Strictly on time. Segment *n+1* starts at start(*n*) + dur(*n*). Has no position feedback, so it can't lag in software. |
| Stepper | Waits for the motor to **land** on each key before loading the next segment. Lag compounds; the stepper drifts out of phase with other lanes. |
| Bus servo | **Cohort pace barrier.** If any bus lane in a gesture falls behind, every bus lane's clock freezes until it catches up. No give-up ceiling. Keeps the pose intact; timing stretches. |

Scott wants **one behaviour for every actuator**, and has decided that **timing wins
over integrity**: a gesture should keep to its schedule rather than stretch to
complete every key in full.

Context: the bench session that prompted this (2026-10-01) found a stepper crawling
beside a PWM-servo gesture. The cause was an ESP32 LEDC write blocking ~40 ms per
call, since fixed in `PardaloteServo.h`. With that fixed, the trace still showed the
stepper finishing segment 1 175 steps behind, and segment 2 loading 892 ms late,
because of the stepper's wait-to-land behaviour.

## The policy

1. **Segments start on schedule.** Segment *n* starts at the gesture's start time
   plus the authored durations of segments 0…*n*−1. It never waits for an actuator
   to arrive, and never waits for another lane.
2. **Each segment starts from where the actuator actually is.** At the boundary,
   `from` = the actuator's current position. The segment's curve then runs from
   there to its target over its authored duration. If the actuator was behind, the
   next segment covers more distance in the same time, so catch-up is built in.
   Lag never carries across a boundary **in time**: every segment still starts on
   schedule. A position shortfall **does** carry forward as extra distance. If a key
   at 20 is only reached at 15, the next leg must cover 15→30 in a 20→30 time slot.
   A speed-limited actuator can therefore stay behind right to the end. That is why
   the final segment needs a landing step (rule 4) and a timeout (rule 5).
3. **Targets come from the authored path, never from the actuator's position.**
   - Absolute gestures: the target is the key's value.
   - Relative gestures: target(*n*) = intended target(*n*−1) + delta(*n*). Only
     segment 0 is relative to the live position. A shortfall therefore can't become
     a permanent offset, and repeated or looping relative gestures don't drift.
4. **The final segment lands.** When the last segment's time is up, the actuator
   keeps moving to the final target. DONE is sent when it arrives.
5. **Landing has a timeout: 2000 ms after the expected arrival**, which is the end
   of the final segment's scheduled time. The grace period is fixed and does not
   scale with move length. If the final target isn't reached by then:
   - the actuator **holds its current position** (same for every type);
   - DONE is sent with an outcome flag of **gave up** instead of **arrived**.

   A stuck, unpowered or LOST actuator can therefore no longer hold a gesture open
   forever, and it never holds up other lanes.
6. **Lanes are independent.** There is no cross-lane or cross-type barrier. Lanes
   stay aligned because they share one clock, not because they wait for each other.

### What this means in practice

- **Expected results:**
  - Keys are aimed at on time.
  - A lane that can keep up looks exactly as authored.
  - A lane that can't keep up cuts corners and clips peaks.
  - Fast reversals (a shake) can shrink in size.
  - Coordinated poses can be momentarily wrong if one lane lags, but lanes never
    drift apart in time.
- **Lag inside a segment is a separate problem.** The policy only corrects at
  boundaries. If an actuator runs slow *within* every segment, it arrives short at
  every key. For steppers this is a firmware fault to fix separately (speed rounding
  to the loop rate; see the stepper section). For bus servos it is mostly physics
  (the servo's own speed limit).

## Per-type changes

### Stepper (`PardaloteStepper.h`, MODE_EASED)
- Advance to the next segment when its scheduled time arrives. Today's
  "land, then load next" step goes, except for the final segment (policy 4).
- `loadStepperSegment()`:
  - `from` = `currentPosition()`. This is already the case.
  - The relative target becomes the previous intended target + delta. Today it is
    `from + value`.
- Landing timeout on the final segment (policy 5).
- **Separate fix:** lag inside a segment. AccelStepper takes at most one step per
  loop pass, timed from the previous step, so a requested speed runs 25–30% slow.
  The 2026-10-01 trace showed 287 → 200 steps/s and 343 → 260. Options:
  - a catch-up term toward the scheduled position;
  - step-interval compensation for loop timing;
  - hardware-timed stepping (FastAccelStepper / timer ISR — the "option C" review).

### Bus servo (`PardaloteBusServo.h`, `serviceGesture()`)
- Remove the cohort freeze. The paced clock becomes the real clock: drop
  `_paused` / `_pausedMs` from segment timing.
- At each boundary, `from` = a live `readPos()`, one read per segment boundary.
  Today `from` is the previous commanded target (`_bsegFrom = _bsegTarget`).
  - On a failed read or a LOST servo, fall back to the previous commanded target.
- Relative targets anchored to the intended path (policy 3).
- Landing timeout (policy 5).
- **Check before removing:** the pace gate was added to stop the stream "outrunning
  the hardware (the cause of the creep)". We must confirm that on-time-plus-re-anchor
  doesn't bring the creep back. Notes are in the "Arduino gesture method
  communication" chat and the PROJECT-STATUS streaming-interpolator entry. The
  `_behind` measurement may still be worth keeping for lag reporting (Q3).

### PWM servo (`PardaloteServo.h`)
- Timing is already on schedule; no change to segment timing.
- `from` is the last *commanded* angle. With no feedback, that is the best available
  "current position", so policy 2 is satisfied in effect.
- Relative targets: confirm they chain from the intended target, not a clamped or
  paced value. With paced output, a pending pulse is still the commanded angle, so
  this should already hold.

### JS (`pardalote.js`) and docs
- `whenDone()` / `isGesturing` semantics follow policy 4–5 (see Q1).
- DONE gains an arrived / gave-up outcome field (Q2). This needs:
  - the frame parsers for all three types;
  - `whenDone()` resolving with the outcome;
  - the extension pages;
  - protocol.md;
  - a protocol MINOR bump.
- Docs to revise:
  - gesture.md (timing semantics);
  - the bus-servo page (barrier description);
  - PROJECT-STATUS (streaming-interpolator entry);
  - CHANGELOG.
- No lag indicator for now (Q3). Authoring-time speed warnings in the Gesture
  Builder remain a possible later idea.

## Open questions

- **Q1 — what does "done" mean? DECIDED (Scott, 2026-10-01): option A.** Done =
  the final target is reached, or the landing timed out. It matches today's DONE and
  keeps `whenDone()` honest about arrival. (Rejected: done = the schedule has
  elapsed.)
- **Q2 — landing timeout. DECIDED (Scott, 2026-10-01):**
  - Length: a fixed 2000 ms after the expected arrival (changed from 1000 ms, same
    day).
  - Reporting: an outcome flag on DONE, **arrived** or **gave up**.
  - A lane that gives up **holds its current position**.
  - Protocol impact: DONE gains an outcome field, the same for every type, so the
    protocol takes a MINOR bump. JS `whenDone()` resolves with the outcome.
- **Q3 — tell the author about lag? DECIDED: not for now.** No lag reporting.
  Revisit after the bench.
- **Q4 — opt-in "integrity" mode? DECIDED: no.** On-time is the only behaviour.

## Bench plan (after implementation)

1. Stepper beside a PWM servo, linear and eased curves. Pass criteria:
   - `late` ≈ 0 at every SEG line;
   - lag doesn't compound across segments;
   - the final DONE arrives on time.
2. Bus-servo multi-lane gesture with one lane deliberately slowed (load or a long
   move). Pass criteria:
   - the other lanes stay on time;
   - the slow lane clips rather than stalling everyone;
   - no creep.
3. A stuck actuator (hand-held bus servo, or a stalled stepper). Pass criteria:
   - the landing timeout fires;
   - the other lanes are unaffected.
4. A relative gesture repeated ~10× on a lane that can't quite keep up. Pass
   criterion: no cumulative drift.

## Temporary diagnostics

The 2026-10-01 trace was removed on 2026-10-05. For timing checks use
`tools/stepper-speed-test/` (its sketch prints board-side move timings).
