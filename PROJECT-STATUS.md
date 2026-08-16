# Pardalote — project status & handoff

Working notes for continuing development. Pardalote is a browser-JS ⇄ Arduino
library: the browser talks to the board over USB or WebSocket (custom binary
protocol); the board runs Pardalote plus opt-in extensions alongside the user's sketch. Goal: let
design students drive real hardware (sensors, servos, steppers, bus servos, LEDs, …)
from either Arduino or p5.js with zero toolchain.

> **Read this first, then read the [README](README.md).** The README documents
> the *public API*; this file captures *state, rationale, and what's left* —
> the stuff that isn't obvious from the code.

---

## 📦 Release status: 1.0.0 released (2026-08-14)

**Pardalote 1.0.0 is released**, protocol **v1.0**. Everything before was
unversioned beta — the v2.x folder naming had no release meaning. Two GitHub
repos, one product version:
- **[ScottMit/Pardalote](https://github.com/ScottMit/Pardalote)** — this monorepo
  (firmware + JS + docs + examples + website). GitHub Release tagged `v1.0.0`
  carries `Pardalote-1.0.0.zip` (Arduino library) and `pardalote-js-1.0.0.zip`
  (bundle + per-board pin maps).
- **[ScottMit/Pardalote-arduino](https://github.com/ScottMit/Pardalote-arduino)** —
  the Arduino **Library Manager** mirror (library files at the repo root, tag
  `1.0.0`, GPL LICENSE at root). Its registry PR merged 2026-08-14; **every future
  tag auto-indexes — no more PRs.**

Release notes live in [CHANGELOG.md](CHANGELOG.md), which defines the versioning
policy (one product version for firmware + JS in lockstep; the wire protocol
versions independently and is checked in the HELLO handshake). Canonical version
locations: `library.properties` (Arduino), `lib/package.json` (JS),
`PARDALOTE_VERSION` in `defs.h`, and `Arduino.version` (= `PARDALOTE_VERSION` in
`lib/src/pardalote-core.js`) for runtime introspection.

**Cutting the next release: follow [RELEASING.md](RELEASING.md)** — the full
checklist (version bumps, `build-release.sh` for rebuild + artifacts + mirror
regeneration, then the manual push/release/tag steps for both repos).

---

## Bench tests & resolved bugs → BENCH-TESTS.md

The full hardware bench log (what's confirmed on which board, the Phase 0–11 runs)
and the write-ups of **bugs found & fixed on the bench** now live in
[BENCH-TESTS.md](BENCH-TESTS.md) — this file stays focused on current and
forward-looking work. The standing caveat still holds: newly written Arduino code is
structurally verified unless a bench entry says otherwise.

---

## What's built this session

> **Note:** this file spans several sessions. The **bare-pins entry immediately
> below** is the most recent work, then the tool-example connection
> standard, the leader-follower example, the bus-servo firmware-limits entry,
> the serial transport + connection key entry, then the
> example rationalisation, the boot-id/provenance reconnect fix, the docs/site
> overhaul, and the `ANALOG_INPUT_MODE` rename; everything after
> them (starting with the stepper homing rework) is from earlier sessions,
> regardless of the "(this session)" labels still on those older bullets.
> (The heading predates the multi-session history.)

- **Bare per-instance pin names — `D13`, `A0`, … work like Arduino (current
  session, Scott's direction).** Replaces the earlier plan of `arduino.pins.D13`
  (rejected) and the standalone `pardalote-pins-<board>.js` files (deleted).
  **How it works:** each
  board-alias name (the union of every table in `BOARD_ALIASES`) is installed as a
  global **string equal to its own name** (`D13 === 'D13'`). The value carries no
  pin number — it's the alias name, and `_resolvePin()` looks it up in *this*
  instance's `_aliases` at call time, so the same global `D13` maps to the right
  physical pin per board and **per `Arduino()` instance** (leader vs follower resolve
  it differently). This threads the needle Scott spotted: a bare global that is still
  instance-specific, because the token is an *indirection*, not the value. Bare `D13`
  and the string `'D13'` are literally the same value — the global just saves the
  quotes, and `_resolvePin` needed no change (it already resolved strings).
  - **Why a string, not a number and not a Symbol** (analysed twice): a magic
    *number* sentinel could be silently truncated to a byte on the wire → wrong real
    pin, so that was out. First landed on a **Symbol** for loud-on-misuse, then Scott
    asked why not just `D13 = 'D13'` — and the string is better for this audience: it
    resolves loudly on an unknown pin exactly like the Symbol (existing `_resolvePin`
    throw), but **interpolates and logs cleanly** (`` `pin ${D13}` `` → `"pin D13"`),
    whereas a Symbol throws on the string-building beginners do constantly. Symbol's
    only edge was catching a pin misused as a string key (e.g. `send(D13, …)`) — far
    narrower than the interpolation footgun it introduced. Switching back also dropped
    the `_resolvePin` Symbol branch and three defensive `String()` wraps the Symbol
    had forced. Cost of the string: a pin shoved into a non-pin string API can act as
    data silently — accepted as the lesser evil.
  - **Collision handling + off-switch.** Installed as **guarded `globalThis`
    properties, NOT top-level `const`** — property assignment never throws the
    redeclaration `SyntaxError` the old files did, and the `name in globalThis` guard
    means we **defer to any name already defined** (reports skips on `console.info`).
    The sole off-switch is **`<script src="pardalote.js" data-pins="off">`** (read via
    `document.currentScript.dataset.pins`); a runtime toggle and `arduino.pins.D13`
    were both considered and dropped as unneeded surface. Install is browser-only
    (`typeof document` guard) so the Node test harness is unaffected. String form
    `'D13'` still resolves everywhere (needed with `data-pins="off"`).
  - **Verified: 20/20** vm-harness assertions against the real built bundle —
    string globals install (incl. ESP32-only `T0`/`DAC1` via the union), interpolate
    cleanly, `data-pins` off installs nothing, same global resolves 13 (UNO-style) vs
    15 (FireBeetle-style) on two instances, number/string paths intact, unknown pin
    throws with the board name, collision guard leaves a pre-existing `SS` untouched.
    Also confirmed a legacy `const A0 = 36` cleanly shadows the property (no crash).
    Re-confirmed live in a real browser via the actual `<script>` tag.
    **JS-only, zero hardware bench** — a two-board leader-follower page is the natural
    in-browser confirmation.
  - **Cleanup done:** deleted the three `lib/pardalote-pins-*.js`; swept ~21 refs
    across `docs-src/reference/{pins,installation,extensions,pin-capabilities}.md`,
    both `potentiometer` examples (dead `<script>` tags — they used `'A0'`/`14`
    already), README, `build_pardalote.py` banner, `build-release.sh` (packaging +
    node-check), CHANGELOG (Unreleased); regenerated `docs/*.html` + `llms*.txt` +
    example pages. `BOARD_ALIASES` in `pardalote-core.js` is now the single source of
    truth for both the string form and the bare globals.

- **Listen-and-switch transport + `requireKey()` (done, 2026-08 — plan executed).**
  `begin()` now runs WiFi **and** listens on USB by default; a deliberate
  `connectSerial()` gesture makes the board drop WiFi and switch to the cable
  (one-way; reset to return). `begin(PARDALOTE_WIFI)` opts out of the USB listen,
  `begin(PARDALOTE_SERIAL)` is USB-only. A silently-reused port can't pull a board off
  WiFi — it fires `'usbBusy'` instead (so a background tab / power-only cable can't
  grab a shared board), and a `CMD_REBOOT` marker lets a browser still holding the
  port re-acquire USB after a board reset with no click. Connection keys moved to
  `Pardalote.requireKey("key")` before `begin()` (replaces the old `begin("key")`),
  over both transports. Wire: `CMD_SERIAL_BUSY 0x0D`, `CMD_REBOOT 0x0E` (+ takeover
  flag on the HELLO probe), folded into protocol v1.0. Code-complete and JS-verified;
  firmware compiles + runs on ESP32 and UNO R4. The full design rationale lived in
  `PLAN-listen-and-switch.md`, now **deleted** (plan executed); shipped behaviour is
  documented in the CHANGELOG 1.0.0 entry.

- **Tool-example CONNECTION STANDARD — canonical, DUPLICATED per example
  (current session, Scott's direction).** All "tool" examples (control-panel,
  servo-control, stepper-motor, coordinated-motion, messaging, bus-servos,
  leader-follower) should share one connection UI *pattern* — but **NOT shared
  code**. Examples must stay copy-one-folder-and-go with zero dependencies, so
  this code is **duplicated verbatim into each example**, with THIS entry as the
  single source of truth to cut from (mitigates drift). Reference implementation
  lives in **`examples/leader-follower/`** (most complete). The standard:
  - **Transport**: a `WiFi | USB` dropdown per board. WiFi shows the IP field;
    USB hides it and connects via `arduino.connectSerial(PROMPT)` — **always**
    raise the port picker (don't silently reuse a granted port). `PROMPT` is a
    library global (`pardalote.js`: `const PROMPT = Object.freeze({ prompt: true })`,
    right next to `const END`), so examples read `connectSerial(PROMPT)` with no
    per-example constant and no new dependency — same idiom as `read(END)`.
    connectSerial's logic is unchanged (it already reads `opts.prompt`).
    **Flipping the dropdown drops the current connection** (`switchTransport()`:
    `manualDisconnect = true; arduino.disconnect(); setConnected(false)`) — a
    browser holds ONE link, so the green "Connected" badge must not carry over
    to the newly-selected channel and imply it's up (Option 1, 2026-08; the
    reject was a reporting-only fix that leaves an orphaned live link on the old
    channel). Composes with the future concurrent dual-transport feature (loose
    end 1b): a single browser page still holds one link, so flipping still
    closes+reconnects that browser's link regardless of the board offering both.
  - **Connect button state**: plain dark `Connect` (`.primary`) when idle; on
    hover it **previews green**; when ready it becomes green **`Connected`**
    (`.connected`). Disconnect shows **`Disconnecting…`** (disabled) during the
    close — USB port-close is slow — restored on the `'disconnect'` event with a
    3 s safety timeout.
  - **Board detection**: `arduino.board` (set on `'ready'`) — `includes('UNO
    R4')` ⇒ the bus is fixed to Serial1 (D0/D1), so lock the pin fields to 1/2,
    disabled + greyed; ESP32 keeps them editable.
  - **Servo-bus pins**: bus examples end each board row with a bold **`bus`**
    label then `RX`/`TX` number fields (≈62px wide so the spinner arrows fit),
    fed to `configureBus({ rxPin, txPin })` before attach.
  - **Canonical CSS to duplicate** (append to each tool's `style.css`; `--green`
    added to `:root`):
    ```css
    --green: #3E9C54;   /* connected */
    /* primary action (Connect): hover previews the green "connected" highlight */
    button.primary:hover { background: var(--green); border-color: var(--green); color: #fff; }
    /* connected state (Connect button, WiFi or USB) */
    button.connected { background: var(--green); border-color: var(--green); color: #fff; }
    button.connected:hover { background: var(--green); border-color: var(--green); color: #fff; }
    ```
  - **JS pattern** (duplicate, per board): a `boardCtx(key)` accessor for the
    board's Arduino + UI fields; `refreshConnectBtn(key)` toggles
    `Connect`/`Connected` + the `connected` class on `'ready'`/`'disconnect'`;
    `applyR4Pins(key)` / `applyTransport(key)` for the lock + IP-hide.
  - **`'usbBusy'` handling (2026-08, listen-and-switch feature):** since the
    standard connects with `connectSerial(PROMPT)` (always a gesture → the board
    switches), `usbBusy` only fires on a *silent auto-reconnect* to a board that
    came back on WiFi. Without a handler the `disconnect` that follows shows a
    misleading "reconnecting…" (reconnect is actually disabled). Canonical snippet
    to duplicate (a flag, because `'usbBusy'` fires just before `'disconnect'` and
    `updateStatus()`/`setStatus()` would otherwise clobber the message):
    ```js
    let usbBusy = false;
    arduino.on('disconnect', () => { /* …existing… */
        if (usbBusy) { usbBusy = false; setStatus('board is on WiFi — press Connect to switch it to USB'); }
        else if (!manualDisconnect) setStatus('reconnecting…'); });
    arduino.on('usbBusy', () => { usbBusy = true; });
    ```
    Rolled into all seven tools (leader-follower uses per-board `leaderUsbBusy`/
    `followerUsbBusy`). See the listen-and-switch transport entry above.
  - **Rejected**: a shared `examples/_lib/connect.js` — DRYer but adds a
    dependency that breaks copy-paste; duplication + this canonical note is the
    deliberate trade. Supersedes the [[deferred-modernise-shared-example-uis]]
    batch's approach.
  - **Rollout DONE (2026-08):** duplicated into all seven tools — leader-follower,
    control-panel, bus-servos, servo-control, stepper-motor, coordinated-motion,
    and messaging (the last is HTML-button based → `classList` toggling instead
    of p5 `addClass`). The four that were WiFi-only (servo-control, stepper-motor,
    coordinated-motion, messaging) gained the WiFi/USB dropdown; bus-servos gained
    the green/`Disconnecting…`/bold-`bus`/R4-lock bits. CSS block appended to each
    `style.css`. **Verified in-browser** (no console errors; green `Connected`,
    USB-hides-IP, R4 pin-lock all work) — **zero hardware bench**; the JS/JS-lib
    is untouched so nothing to upload, but two live USB ports + the per-tool USB
    path want a bench pass.

- **Leader–Follower teleoperation example (current session)** — new browser-only
  tool `examples/leader-follower/` driving TWO boards (two `Arduino()` instances,
  one per LeRobot-style 6-servo arm). Leader is hand-moved (torque off, polled);
  a relay streams its joint positions to the follower via a follower `group()`
  (one SyncWrite/frame per tick, ~20 Hz, only on movement, skips non-answering
  joints). Per-joint **sync** (toggle: capture matched origins, cancels install
  offset; un-synced origin = servo centre so **flip** mirrors correctly either
  way) and **flip** (toggle: mirror). **Set-limits** button cycles set →
  recording (frees follower, captures each joint's hand-moved range, EXTENDS on
  repeat) → active (applies board soft limits); pressing at "active" IGNORES
  them (grey marks, range remembered); **clear limits** wipes (and, mid-record,
  keeps recording a fresh range). **Free follower** toggles torque (green when
  free). Uses the connection standard above. Two simultaneous USB ports
  bench-confirmed by Scott. **Zero hardware bench beyond that** — the relay/sync/
  flip/limits logic is JS-verified in-browser only. (Bug caught + fixed: naming
  a `const CENTER` shadowed p5's `CENTER` align constant → renamed `SERVO_CENTER`.)

- **Bus-servo firmware-limit read + example diagnostics (current session)** —
  prompted by Scott's first bus-servo bench test: the UNO R4 resets (or drops
  WiFi) when a servo is driven past its own firmware angle limit, and it was
  hard to see when. Built the tooling to get clarity; **all zero bench time.**
  - **New command `CMD_BUSSERVO_READ_LIMITS 0x62`** (JS→Ar `[id]`, Ar→JS
    `[id, min, max]`). The board reads the servo's EEPROM min/max ANGLE-LIMIT
    registers (`SMS_STS`/`SCSCL_MIN/MAX_ANGLE_LIMIT_L` via `readWord`) **once at
    attach**, caches them (`_fwLimitMin/Max[id]`, int16 raw, −1 = no answer),
    and replays the cache in `announce()` — no EEPROM re-read per connect. The
    command forces a fresh read (JS `readFirmwareLimits()`). Reset to −1 on
    detach. These are the servo's OWN firmware limits — **read-only, never
    written** (distinct from the board-RAM soft limits of `SET_LIMITS`).
  - **JS `busServo.js`:** `readFirmwareLimits()` (always re-reads, resolves
    `{min,max,enabled}|null`), plus the cached property **`arduino.<servo>.
    firmwareLimits`** (updated by attach/announce/refresh; `null` until read or
    on no-answer). Interpretation lives JS-side: `enabled = !(min===0 &&
    max===0)` — Feetech's min==max==0 = "limits off / multi-turn"; a −1 raw
    value (dead/absent servo, distinct from a real 0) → `null`. Added to
    `getState()`; cleared + resolvers drained in `_reset()`. `frame_names.h`
    entry added for the monitor.
  - **`bus-servos` example** (Scott's asks): (1) **WiFi/USB transport dropdown**
    copied from control-panel (persisted, hides IP in USB mode, `connectSerial()`
    branch) + commented `begin(PARDALOTE_SERIAL)` in `bus-servos.ino` — the
    diagnostic lever: if the reset persists over USB it isn't WiFi. (2) **Soft
    limits removed** (`setLimits(1024,3072)` gone) so the servo's firmware limits
    are the only wall — the thing being probed. (3) **Two-needle dials** — TEAL =
    current (live feedback, the arm "left behind"), AMBER = target (follows the
    mouse drag) — plus **RED ticks** at the firmware limits (only when
    `firmwareLimits.enabled`). Dragging past a red mark shows amber crossing it
    while teal stalls. Verified **offline in-browser only** (greyed dials render,
    dropdown toggles the IP field, no console errors); needs a servo on the bench
    for the real behaviour.
  - **Still to bench:** does the attach-time EEPROM read behave on the R4; do
    the red marks land where the servo actually stops; and — the original bug —
    does driving to/past a firmware limit reset the board, and is it WiFi-only
    (USB transport is now the A/B test). SC-series read shares the ST path,
    lower-confidence as ever.

- **SC-series bus-servo compile fix (current session)** — see Loose ends #6.

- **USB serial transport + opt-in connection key (earlier session)** — two
  features, built in this order deliberately: the transport seam first, then
> example rationalisation, the boot-id/provenance reconnect fix, the docs/site
> overhaul, and the `ANALOG_INPUT_MODE` rename; everything after
> them (starting with the stepper homing rework) is from earlier sessions,
> regardless of the "(this session)" labels still on those older bullets.
> (The heading predates the multi-session history.)

- **USB serial transport + opt-in connection key (current session)** — two
  features, built in this order deliberately: the transport seam first, then
  auth as a WS-only add-on (over serial, the cable IS the auth). **32-bit
  boards only** — the UNO R3/AVR plan was weighed and dropped (its only unique
  payoff was the AVR family; its cost was a forever 2KB-RAM tax on every future
  feature). Kept from that analysis anyway: CRC+resync in the envelope,
  serial-on-every-board, and the fixed-width-types rule for new code.
  - **Transport seam (firmware).** All bytes now leave through
    `_sendRaw(client, buf, len)` (the ONLY raw-send site; routes to `_ws` or
    the serial transport) and client lifecycle funnels through
    `_onClientConnected/_onClientDisconnected` + `_handleBinary`, shared by
    both transports. The WS event handler is a thin adapter over those. The
    serial client is permanently **client 0** — all per-client machinery
    serves it as a degenerate case. `PARDALOTE_NO_WIFI` (set by platform.h for
    the **UNO R4 Minima**, now a supported board) compiles out
    WebSocketsServer + wifi_config entirely. **Transport policy (settled
    after some back-and-forth):** WiFi is the default and there is NO
    runtime WiFi→serial failover on WiFi-capable boards; on the Minima —
    where serial is the only transport the hardware can have — every
    `begin()` form starts serial (with a Serial note). A briefly-shipped
    stricter version (Minima `begin()` = error) was reverted.
  - **Serial transport** (`internal/serial_transport.{h,cpp}` + JS
    `_SerialLink`): envelope `0x00 0xA5 COBS(msg+CRC8) 0x00` — COBS means the
    body contains no 0x00, so the decoder ALWAYS resyncs on the next
    delimiter (a corrupt byte costs one message, never the link), and the
    sketch's own `Serial.print` text passes between envelopes untouched → JS
    surfaces it as the **`'log'` event** (debug prints visible in the browser,
    no IDE). One envelope = one WS binary message (a frame or a JS batch), so
    frame parsing is unchanged. Connection semantics: board marks client 0
    connected on first valid envelope; disconnect = 8 s rx-timeout (JS
    heartbeat pings every 3 s, so this also stops writes into a dead port —
    `Serial.write` with no host draining can block on native-USB boards, the
    R4 loop-starvation lesson again). JS probes with a **JS→board CMD_HELLO**
    every 500 ms until the first envelope; the board answers a HELLO request
    by re-arming the full HELLO→announce→SYNC_COMPLETE sync (covers reload
    inside the rx-timeout window AND the DTR reset on port open). Web Serial:
    Chrome/Edge only, first `connectSerial()` needs a click (port picker),
    granted port reused silently on return visits (`{ prompt: true }` forces
    the picker); `baudRate` fixed at 115200. Camera stays WiFi-only (HTTP).
  - **Connection key** (`CMD_AUTH 0x0C`, WS only): `Pardalote.begin("key")` ⇄
    `arduino.connect(ip, { key })`. JS sends AUTH as the FIRST frame on
    socket open; until a client is authed it receives NOTHING (no HELLO, no
    announce, no broadcasts — `_clientReady()` gates every send loop) and all
    its frames but AUTH are dropped. Match → normal HELLO flow (HELLO is the
    acceptance, no AUTH reply). Mismatch → board sends `CMD_AUTH [2]` + closes;
    no-key-within-3s → `CMD_AUTH [1]` + closes. JS surfaces either as
    **`'authFail'`** and — critically — **disables auto-reconnect** (a wrong
    key must be one clear error, not a silent retry loop hammering the board).
    Key ≤32 chars, cleartext ws:// — documented as an accident latch, NOT
    security. Old JS + keyless board and old firmware + keyless connect are
    both unaffected; wire addition folded into protocol v1.0 pre-release (no
    bump — v1.0 is unreleased).
  - **JS side**: `connect(ip, portOrOpts)` (number = port, back-compat;
    object = `{ port, key }`), async `connectSerial(opts)`, session-reset
    factored into `_resetSession()` (shared by both), `_connectSocket()`
    branches to `_connectSerialLink()`; reconnect/backoff/heartbeat/flush all
    shared — `_SerialLink` mimics the WebSocket handler surface (`onopen/
    onclose/onmessage/send/close` + `onlog`). On serial open failure it
    re-acquires the port via `getPorts()` (unplug/replug gives a fresh
    SerialPort object) before the next backoff attempt.
  - **Verified** (no hardware): all firmware TUs + a sketch-shaped TU with
    every extension stub-compile clean on **ESP32, UNO R4 WiFi, and UNO R4
    Minima** (`-fsyntax-only`, /tmp stubs rebuilt — note for resuming: Arduino
    cores need `min`/`max`/`HEX`/interrupt macros in the stub, and the
    capturing-WS behavioral stub must NOT define min/max macros or <vector>
    breaks). **43 harness assertions pass**: C++⇄JS envelope byte-compat both
    directions (incl. trailing-zero and 254-run COBS edges — the streaming
    encoder's canonical final-block case was a real bug caught pre-commit),
    corruption→resync, chunked reassembly, log-text coexistence, AUTH-first
    frame + reject→no-reconnect + no-AUTH-without-key (Node harness on the
    real pardalote.js via fake WebSocket), full `connectSerial` flow on fake
    Web Serial streams (probe→HELLO→ready, 'log', heartbeat-over-envelope,
    disconnect closes port), and the firmware auth state machine end-to-end
    (real `Pardalote.cpp` + capturing WS stub: wrong key→[2]+disconnect,
    right key→HELLO/SYNC/PONG, 3 s timeout→[1], broadcasts skip unauthed).
  - **Zero bench time** — hardware TODO below. Docs (site-wide sweep, Scott's
    direction: home page keeps "no cables and no server", WiFi card became
    **"WiFi or wires"**): README + Arduino-library README ledes,
    `connecting.md` (connect opts, connectSerial, authFail/log events),
    `arduino.md` (three begin() forms), `wifi.md` (page-skippable note),
    `installation.md` (Minima + WebSocketsServer scope), `troubleshooting.md`
    (3 serial entries: Serial-Monitor-holds-the-port, ESP32 DTR reset,
    NeoPixel byte loss), `download.html`, reference index; CHANGELOG 1.0.0
    bullets; all HTML rebuilt. **control-panel gained a WiFi/USB transport
    dropdown** (IP field hides in USB mode, choice persisted in
    `pardalote-control-panel`, first USB connect needs the click-gesture
    picker; `minimal-pardalote.ino` carries a commented
    `begin(PARDALOTE_SERIAL)` line). Deferred example candidates:
    basic-serial-switch (serial twin of basic-light-switch), a board-console
    tool for the 'log' event, a key demo in shared-light-switch.

- **Example house style + out-of-box tools — stage 1 of the example
  overhaul (current session)** — goals set by Scott: basics truly basic
  (sometimes fun), one consistent visual style matching the website, and
  'Tool' examples usable with zero code editing (like control-panel's IP
  field). Stage 1 converts the reference pair — `stepper-motor` and
  `coordinated-motion` — for review before rolling out to the rest.
  - **House style** (`examples/stepper-motor/style.css` is the canonical
    copy — the header comment says to copy it verbatim into new examples):
    mirrors the site's "Graph Line / Bauhaus" theme — white paper +
    40px graph-paper wash, Poppins, 1.5px ink (#2B2420) outlines, square
    corners, teal (#3FA9A0) = live/active, amber (#E8A33D) = highlight,
    orange (#D3542B) = warning/primary-hover, mono for numbers/logs.
    Canvas is an outlined white card; p5 palette constants (INK/GREY/HAIR/
    TEAL/AMBER/ORANGE) mirror the CSS vars. Dial language: hairline ring,
    teal needle, ink hub, amber target-ghost/limit pulse, orange
    coils-free/fail.
  - **Out-of-box tools:** both sketches lost the `ArduinoIP` constant —
    IP + Connect on the page; stepper gained a Wiring row (STEP/DIR vs
    4-wire + pin fields, applied on Connect); coordinated-motion gained
    pin/ID fields under each dial (change rebuilds the group). All
    settings persist in localStorage (`pardalote-stepper-motor`,
    `pardalote-coordinated-motion`) and a returning visit auto-connects.
    Defaults now match the READMEs (driver 2/3/4, 4-wire 8/9/10/11;
    CM stepper B 8,9 — README previously said 4,5, stale).
  - READMEs' Browser sections rewritten for out-of-box use (the stepper
    README's keyboard-controls table described handlers that no longer
    existed in the sketch — removed). index.html got titles + viewport.
    Docs rebuilt. **Not bench-tested against hardware.**
  - **Stage 2 (same session): all five tools converted.** After Scott's
    review pass on the pair (row reorder to button-then-fields, Board IP
    label, Disconnect buttons with a manual-disconnect status guard,
    steps/rev fields — stepper Profile row + per-motor in CM where one
    dial lap = one rotation = steps/rev steps commanded, stepper 4-wire
    type in CM, fixed-width Pause/Resume), the style + out-of-box
    pattern went to the remaining tools: **bus-servos** (IDs editable
    under the display, torque buttons + [1]/[2] keys, orange ring =
    freed joint; store `pardalote-bus-servos`), **messaging** (plain-HTML
    panels restyled as outlined cards, teal=in/orange=out frame lines;
    store `pardalote-messaging`), **control-panel** (house header/rows,
    persistence incl. last board, Disconnect; pin cards remapped to
    light palette — teal/orange HIGH/LOW, amber PWM slider + pin dots,
    hairline connectors; wrapper now mounts inside <main>; store
    `pardalote-control-panel`). House layout rule: **wiring/config rows
    go under the display.** Further review-pass fixes: stepper rows
    reordered again (slider after runSpeed), 26px canvas margin-bottom
    (in the shared canvas rule), CM rows labelled (Board IP / Sweep) +
    Disconnect + a 4-wire stepper type (IN1–IN4 on two fixed lines via a
    flex .brk) + per-motor steps/rev fields (one dial lap = one rotation
    = steps/rev steps commanded), stepper Profile gained steps/rev,
    control-panel graph-paper now header-band only (boards on plain
    paper below), pin-name ellipsis + 90px slider min-width, 24px
    EDGE_PAD baked into the pinout container width (margins don't count
    in scroll extent), messaging gained a live Code panel showing the
    constructed `arduino.send()` call.
  - **Stage 3 (same session): all basics converted + servo-control
    promoted to a tool.** Basic template (established on
    `potentiometer-p5js`, Scott-approved): teaching stays in sketch.js,
    chrome stays in HTML/CSS — static heading + mono hint in index.html
    (`<main id="main">`; p5 `.parent('main')` needs the **id**, it
    doesn't take selectors), house style.css copied per folder, house
    palette in the canvas (teal = connected/live, orange = disconnected),
    placeholder IP `192.168.x.x`, basics keep the edit-one-line ritual
    (no settings UI, no persistence). Converted: basic-light-switch,
    shared-light-switch (amber-lit indicator), shared-potentiometer
    (teal bar), shared-servo, ultrasonic-sensor (teal→orange proximity
    bar), IMU (HUD as outlined house card; axes X=orange Y=teal Z=amber
    matching HUD labels; orange benchy on teal PCB, white WEBGL bg),
    camera-stream (cream placeholder card). **NeoPixel simplified** per
    the "fun but simpler" goal: colour-field + get() + rainbow-hover
    replaced by mouse = colour mixer (x=hue, y=brightness), page becomes
    the colour, strip follows, dot-row strip preview; instance renamed
    `neoStrip1`→`strip` (README updated to match). **servo-control is
    now the sixth tool** (was already a full panel, old dark style):
    house style, Board IP + Connect/Disconnect, pin field under the
    gauge, `pardalote-servo-control` persistence, rows reordered
    button-first, Tool tag + NO_CODE on the site; its README's stale
    mouse-follow/keyboard-shortcut sections rewritten (they described a
    long-gone sketch). Cleaned: unused 202-line boards.js copy in
    potentiometer-p5js; potentiometer README gained a pin-alias-file
    table (swap the script for your board / raw GPIO always works).
    Site gallery: servo-control + neopixel blurbs refreshed; docs
    rebuilt. All JS syntax-checked; **nothing bench-tested on hardware
    yet** (bus-servos re-attach path, servo-control tool, CM steppers
    especially).

- **Example rationalisation — one Arduino sketch per website example
  (current session)** — renamed every browser example folder and Arduino IDE
  example so the pairing is explicit; no code changes, names/links only.
  Web folders (`examples/`): `basic-LED-example`→`basic-light-switch`,
  `basic-p5js-example`→`potentiometer-p5js`, `shared-control-example`→
  `shared-light-switch`, `shared-input-example`→`shared-potentiometer`,
  `shared-servo-example`→`shared-servo`, `servo-example`→`servo-control`,
  `stepper-example`→`stepper-motor`, `busservo-example`→`bus-servos`,
  `coordinated-motion-example`→`coordinated-motion`, `neopixel-example`→
  `neopixel`, `ultrasonic-sensor-example`→`ultrasonic-sensor`,
  `imu-example`→`IMU`, `camera-example`→`camera-stream`. IDE sketches
  renamed to match their web example (`basic-LED`→`minimal-pardalote` —
  serves control-panel, basic-light-switch AND potentiometer-p5js —
  `servo`→`servo-control`, `stepper`→`stepper-motor`, `busservo`→
  `bus-servos`, `ultrasonic`→`ultrasonic-sensor`, `imu`→`IMU`,
  `camera`→`camera-stream`). The three sketches that lived INSIDE web
  example folders moved into the IDE examples as `shared-light-switch`,
  `shared-potentiometer`, `shared-servo`; `coordinated-motion` (previously
  synthesized inline by `build_examples.py`) is now a real IDE sketch.
  **Deleted** the IDE examples with no website example (Scott's call):
  `arduino-read`, `shared-stepper`, `shared-busservo`, `shared-imu`,
  `shared-neopixel`, `shared-ultrasonic` (their README/reference mentions
  removed too — the `arduino-read` pointer lines in README.md and
  `extensions.md` were dropped). `messaging` kept, then **promoted to the
  site gallery** (follow-up request): web folder renamed
  `messaging-example`→`messaging`, its embedded (richer) `messaging.ino`
  replaced the simpler library copy — one sketch now, in the IDE examples —
  and its uptime tick fixed 5000→1000 ms to match its own docs.
  Site: `messaging`, `stepper-motor`, `bus-servos`, `coordinated-motion`
  now carry the `Tool` tag and, like control-panel, render without source
  code (`NO_CODE` in `build_examples.py`); "Basic LED"→"Basic light
  switch", "Ultrasonic distance"→"Ultrasonic sensor". Docs regenerated with both
  build scripts; stale old-slug HTML deleted. Old example-page URLs are
  now broken by design (no redirects on GitHub Pages). Historical names in
  this file and CHANGELOG.md left as-is.

- **Boot id + pin provenance — stale state no longer replayed onto new
  firmware (current session)** — fixes a bench-found bug: firmware A shares
  `A0` (`ANALOG_INPUT_MODE` auto-poll); upload firmware B *without* the
  share; on reconnect the browser kept polling `A0`. Cause: `_onSyncComplete`
  replayed ALL of `_pinModes`/`_pinValues`/`_reads` on every reconnect, and a
  read created by a board `share()` announce was indistinguishable from a
  browser-requested one. Two complementary fixes, rule: **each side is source
  of truth only for what it created.**
  - **Pin provenance (JS-only):** `_pinOrigins` maps pin → `'browser'|'board'`
    ('browser' is sticky — set by `pinMode`/`digitalWrite`; inbound
    CMD_PIN_MODE marks unclaimed pins 'board'); `_reads` entries carry their
    own `origin` (an explicit `analogRead(pin, interval)` on a board-shared
    pin upgrades it to 'browser'). `_onSyncComplete` now replays only
    browser-originated modes/values, and **sweeps** board-originated pins the
    announce didn't re-mention (`_staleBoardPins`, snapshotted at HELLO,
    cleared per-pin as announces arrive). Surviving reads (both origins) are
    still all re-sent — the board's action table clears on every disconnect
    and only JS knows the interval. The sweep alone fixes the bug even on
    firmware without boot ids.
  - **Boot id (protocol):** HELLO gained param[3] — a random 31-bit token
    generated once per boot (`esp_random()` on ESP32; `randomSeed(micros() ^
    (millis()<<16))` + `random()` elsewhere, seeded post-WiFi-connect for
    jitter entropy; never 0 — 0 means "old firmware, no boot id"). JS compares
    across reconnects: changed → board rebooted → `_dropBoardCreated()`
    (board-origin pin state, `_sharedFromBoard` extensions — which previously
    ghosted across auto-reconnect to new firmware, only `connect()` dropped
    them — plus `messages` cache and `_available`), then the announce
    repopulates what really exists; same id → pure network blip, keep
    everything. New `'reboot'` event fires (before `'ready'`). Rejected
    alternatives: JS-passed connect time (identifies the wrong end),
    a board-side "fresh boot" flag (can't answer "rebooted since *my* last
    contact" per-client). Wire: old JS ignores the extra param; new JS treats
    absent as 0 and falls back to the sweep. Docs TODO: add `'reboot'` to the
    events reference on the next docs rebuild.
  - Verified: Node harness driving the real `pardalote.js` through fake
    WebSockets — 17 assertions across firmware-swap (with and without boot
    ids), same-boot network blip (poll retained AND re-registered),
    reboot (board state dropped, browser state replayed, event fires),
    browser-claimed poll surviving a swap, and `connect()` full wipe.
    Firmware stub-compiled clean on BOTH platform paths (ESP32 + UNO R4
    branch of the boot-id generation). **Zero bench time** — hardware TODO
    below.

- **Documentation + docs-site overhaul (current session)** — no firmware/JS
  behaviour change; audited the README and the generated reference docs
  (`docs-src/reference/*.md` → `docs/reference/*.html` via `build_reference.py`)
  against the actual code and fixed the drift that had accumulated:
  - **Stepper docs** described the *pre-rework* homing model and still said
    limit-switch homing was "planned for a future version" — rewrote to
    home-is-origin, documented `setSwitchPosition()`, added `hardStop()`, and
    added the `onLimit`/`onHomeFail` shorthands. Fixed the same stale lines in
    the README.
  - **Bus-servo sketch API** was documented as hardware-id addressed; it's
    logical-id now — corrected the table + examples in `extensions.md` and the
    README.
  - Added a **Messaging** reference page (the `CMD_MESSAGE` channel + frame
    monitor had no reference page at all), organised by direction —
    *JavaScript to Arduino* / *Arduino to JavaScript* — each showing both the
    send and the receive call.
  - **Reference nav restructured** in `build_reference.py`: new **Core —
    Messaging** section, section headings are now clickable links, and the
    "sketch creates the object" + "reading/writing actuators from the sketch"
    material moved off the Arduino page into the **Extensions overview**.
  - **Language cues:** JS/Arduino **badges** on every code card (added to both
    `build_reference.py` *and* `build_examples.py`), and the `.sig` signature
    bubbles are now colour-coded by language (teal = Arduino, yellow = JS,
    auto-classified at build time by whether the sig text mentions `Pardalote`).
    Capped `.sig` width to the content column (it was overflowing on wide
    windows). CSS lives in `docs/css/site.css` (hand-edited, not generated).
  - **Bug fixed in `build_examples.py`** (pre-existing): three `ARDUINO` sketch
    paths pointed at files that don't exist — the `.ino`s live in same-named
    subfolders — which crashed the examples build partway. Corrected.
  - Rebuilding needs `markdown-it-py` + `mdit-py-plugins` + `pygments`; run both
    `build_reference.py` and `build_examples.py` from `docs-src/`.

- **Pin-mode constant renamed `MODE_ANALOG_INPUT` → `ANALOG_INPUT_MODE`
  (current session)** — unified the one pin mode a sketch names directly
  (the JS side had already dropped the prefix as `ANALOG_INPUT`, so the two
  sides were inconsistent). Chose the `_MODE` **suffix** over a bare
  `ANALOG_INPUT` deliberately: pin-mode names are an unscoped, crowded `#define`
  space (ESP32 defines `ANALOG`; some Pycom builds `#define ANALOG_INPUT 0x0`),
  so the suffix stays clear of them without a fragile `#ifndef` guard (an
  earlier guarded-alias attempt this session was replaced by the rename). **Wire
  value unchanged (`8`) — token-only, behaviour-neutral.** Touched
  `internal/defs.h` (+ rationale comment), the two `case` labels in
  `Pardalote.cpp`, `pardalote.js` (`const` + the `pinMode` check), and all
  docs/examples. **Public-API note:** any existing user `sketch.js` that used
  `ANALOG_INPUT` must update to `ANALOG_INPUT_MODE` (in-repo examples already
  done).

- **Stepper homing rework — home is the origin (prior session)**
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
  incl. a live traffic inspector) and IDE `examples/messaging/`. **Confirmed on
  ESP32 and UNO R4 hardware (2026-07, Phase 2)** — watch/retain/broadcast/monitor
  all pass; only the text/blob byte-cap edge cases remain (see the bench log).
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
  `examples/shared-servo-example/`. The servo path is now **bench-proven on ESP32**
  (2026-07, Phases 4.1–4.3; idempotent 4.4 and the UNO R4 path 4.5 still open).
  Steppers/bus servos follow the same pattern but remain **unrun on hardware**
  (Phase 8).

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

- **Framework completion: sketch attach() for NeoPixel, Ultrasonic, IMU
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
  (cm, blocking) / `readInches` / `setTimeout`; IMU → `attach(name,
  model?,addr?,sda?,scl?)` + `read()` (→ `PardaloteIMUReading`) /
  `setAccelRange`/`setGyroRange`/`calibrate`. **IMU was the awkward one:**
  its attach carries the model NAME as a payload, which `Pardalote.
  command()` (int-params only) can't send — so the attach body was
  refactored into a shared `attachDevice(id,addr,code,sda,scl)` that both
  the browser handler and `sketchAttach` call (truly one code path),
  and `sketchAttach` broadcasts the SHARE/ATTACH(+model payload)/range
  frames itself. Sketch reads for the sensors are board-local (blocking
  I2C/pulseIn), not broadcast. New IDE examples: `shared-neopixel/`,
  `shared-ultrasonic/`, `shared-imu/`. Stub-compile now covers all six
  extension headers (added Adafruit_NeoPixel/Wire stubs). **Camera is the
  only device without sketch attach** — deliberately deferred (singleton,
  ESP32-only, conceptually unlike the multi-instance devices). The
  **browser-driven** NeoPixel/Ultrasonic/IMU paths are now confirmed on ESP32
  (2026-07, Phases 9–11); the **sketch-created** `attach()` variant of all three is
  still unrun (9.3, 10.2, 11.4).

### Protocol map (for adding commands)
Device IDs: neopixel 200, servo 201, ultrasonic 202, imu 203, camera 204,
stepper 205, busservo 206. Command blocks: servo `0x14–0x1D` + limits
`0x54`, stepper `0x33–0x40` (0x40 = HOME, now implemented) + timed
`0x4F–0x50` + switches `0x52–0x53` + home `0x55`, bus servo `0x41–0x4E`
+ `DONE 0x51` + `READ_LIMITS 0x62` (read the servo's EEPROM angle-limit
registers — the only bus-servo code outside the 0x41–0x4E block, placed
at 0x62 because that block is full and NeoPixel ends at 0x61). `CMD_SHARE
0x56` is reserved across ALL device IDs (sketch-created objects; now servo,
stepper, bus servo, NeoPixel, ultrasonic, AND IMU — every device except
camera). Command codes 0x14–0x63 are now used; next globally-free: `0x64`.
(Dispatch is by (deviceId, cmd), so codes may be reused per-device. Recent
bus-servo additions: `READ_LIMITS 0x62`, `PRESENT 0x63` — attach-time servo
presence, Ar→JS `[id, servoId, present]`, cached + replayed in announce.)
**Core** commands run 0x00–0x0B; `CMD_AUTH 0x0C` (connection key, 2026-07)
is the newest. Next free core cmd: `0x0D`. `CMD_MESSAGE 0x0B` is routed by
CMD, not target range. `CMD_HELLO` params are `[major, minor, adcBits,
bootId]` (bootId added for reboot detection — no new command, no version
bump; both sides tolerate its absence); `CMD_HELLO` is also valid JS→board
as a "(re)introduce yourself" request — the serial transport's probe uses
it. See `src/internal/defs.h`.

---

## Loose ends (deferred, in rough priority)

_Resolved items (bugs fixed on the bench) have moved to [BENCH-TESTS.md](BENCH-TESTS.md); the numbering keeps its gaps (0b, the old `0.`) so existing references still line up. Only open/deferred work remains below._

0a. **Surface "Unknown extension deviceId" to the browser (2026-08, DX).** When
   the board gets a frame for a device with no registered extension,
   `dispatchExtension()` (`internal/extensions.cpp`) only prints
   `Unknown extension deviceId: N` to Serial and drops it. This is a SILENT
   failure in the browser — the classic footgun is uploading a sketch that
   forgot `#include <PardaloteBusServo.h>` (device 206): WiFi connects, the
   Connect button goes green, the dials just sit there, and nothing in the
   browser console says why. It has now cost TWO separate bench-debug sessions
   (Scott, opening and closing this whole effort). **Fix:** on the no-match
   branch, send a frame back to the requesting client (new core cmd, or reuse a
   log/warn channel) carrying the unknown `deviceId`; JS maps it to the
   extension name (200 NeoPixel, 201 Servo, 202 Ultrasonic, 203 IMU, 204 Camera,
   205 Stepper, 206 BusServo, 207 Encoder) and emits a `'warn'`/error event like
   *"the board has no BusServo support — add `#include <PardaloteBusServo.h>` to
   the sketch and re-upload."* **Dedup per deviceId** (or throttle) so a stream
   of dropped frames doesn't spam. Cheap, and it turns a green-tick-but-dead
   mystery into a one-line diagnosis.

0c. **Leader–follower relay latency (2026-08, open — Scott to pick up).** On the
   bench (two 6-servo arms, `examples/leader-follower/`) the follower's response
   to the leader lags more than expected, and intermediate values are visibly
   dropped to catch up — noticeable on ESP32, **more so on the UNO R4**. The drop
   is partly by design: the write path coalesces (leading value immediate, rapid
   follow-ups → one trailing send) to avoid queue build-up / R4 loop-starvation.
   So this is a *pipeline* question, not a bug: the relay chain is board poll rate
   (leader positions → browser) → transport round-trip → follower SyncWrite
   throttle/threshold, and the R4 has the least `loop()` headroom to push any of
   them faster. Levers to explore: the leader read/poll interval, the SyncWrite
   throttle + change threshold, and whether the R4 can sustain a higher relay
   rate at all. **Separate from** the bus-servo LOST back-off fix
   ([[busservo-lost-backoff]]) — that fixes the servo-dropout crash and neither
   improves nor worsens this latency (it doesn't touch the healthy poll rate).

0d. **Unify the write-side rate-limiter (2026-08, design note — came out of the
   0c latency trace).** Observation: outbound *read* streaming is unified — every
   extension shares `ExtReadPoll` with its interval+threshold gate
   (`internal/extensions.h`, `gate()`) — but outbound *write* rate-limiting is
   fragmented. `analogWrite` has a proper leading-immediate / trailing-coalesced /
   threshold scheduler (`_pwmScheduleWrite`/`_pwmSend`, `pardalote.js`); `group.write`
   builds one SyncWrite and flushes immediately; and every streaming *example*
   hand-rolls its own copy of the scheduler in userland (leader-follower's
   `relayTick` = `RELAY_MS` interval + `RELAY_THRESH` deadband + `lastRelayed`
   last-value-wins is exactly `_pwmScheduleWrite` re-implemented). So the "good
   scheduler" exists but only `analogWrite` may use it.
   - **Why this is NOT a blanket-unify.** The two write kinds have different data
     semantics and the difference is real: a PWM pin write is **scalar and
     idempotent** — dropping intermediate values and landing only the latest is
     *lossless* (the pin ends where you asked), so coalescing is free. A
     `group.write` is a **coordinated atomic latch** ("these N latch together,
     now"), and `writeTimed`/`gesture` carry duration semantics — routing them
     through a trailing-send timer would break "arrive together", desync the
     `whenDone`/`_armDone` promises (they assume the frame leaves when `write()` is
     called), and for a relay would *add* latency. So coordinated writes must stay
     immediate.
   - **Proposal (keep the layering, share the code):** (1) extract the
     leading-immediate / trailing-coalesced / threshold logic out of the PWM path
     into a small helper keyed by an arbitrary string (not a pin); `analogWrite`
     becomes one caller. (2) Give single-actuator streaming writes
     (`servo.write`, `busServo.write`) an **opt-in** `writeThrottle` that routes
     through the same helper — so a `draw()`-loop / mouse-drag write gets the
     protection `analogWrite` already has, without each sketch re-implementing it.
     (3) Leave `group.write`/`writeTimed`/`gesture` **immediate by default** — an
     app that needs to pace a *group* stream still does it at the app layer (as
     `relayTick` does), because only the app knows the coordination cadence.
     Result: writes get the one-implementation story reads already have, minus the
     "analogWrite-only" asymmetry, without corrupting coordinated semantics.
   - **Caveat — this is a cleanup, not the 0c lever.** For the leader–follower
     relay the stream is *already* paced, so more coalescing won't help; the 0c win
     is the opposite (event-driven relay off the leader's `'change'` event to
     *remove* a scheduling stage). Track this note as code-quality; keep 0c as the
     latency work. [[deferred-modernise-shared-example-uis]] is a separate batch.

0e. **✅ DONE (2026-08) — JS distribution bundle.** Single all-in-one
   `lib/pardalote.js` bundle (built from `lib/src/` by `build_pardalote.py`), the only
   file a sketch includes — it sidesteps the p5.js Web Editor's per-file
   preprocessing (which chokes on the extension files standalone). Full write-up in
   the CHANGELOG and the `lib/` restructure notes.

1. **LLM control layer** — the original studio goal, deliberately deferred. The
   groundwork *is* the substrate for it: `group.read()` → policy → `group.writeTimed()`
   is the LeRobot-style loop.
1b. **Concurrent dual transports (WiFi + serial simultaneously)** — deferred
   2026-07, Scott's preferred shape after an auto-switch idea was examined
   and rejected. **Design: don't switch modes — run both.** The serial
   client becomes one more client slot alongside the WS clients (everything
   already routes per-client through `_sendRaw`; the main change is
   per-client transport routing instead of the global `_transport` flag,
   plus `run()` servicing both `_ws.loop()` and `_serialT.loop()`). No mode
   state → no capture problem (a background Chrome tab auto-probing can't
   steal a board off WiFi), no switch-back ambiguity. **Why auto-switching
   was rejected:** (a) the "WiFi won't connect" state lives inside the
   blocking `begin()`/`wifiConfigConnect()` loops — watching serial there
   means rebuilding WiFi bring-up as a state machine; (b) during that exact
   window serial is already the config menu, so probe envelopes and menu
   keystrokes fight over the same byte stream; (c) Chrome opening the port
   DTR-resets a classic ESP32 (hardware auto-reset circuit — firmware can't
   decline), so "switch on request" reboots the board on our main platform
   while the R4's native USB doesn't — split behavior; (d) every
   auto-switch rule creates a new "board isn't where I expected" mystery,
   the accident class the connection key exists to prevent. **Known issues
   the concurrent design still has to settle:** config-menu vs envelope
   arbitration on the serial stream; the ESP32 DTR reset on port open
   (unavoidable — document it); serial stays live only after `begin()`
   completes (this feature is NOT a WiFi-rescue — the config menu already
   serves that); and the auth asymmetry (a keyed board is still open via
   the cable — consistent with key-is-a-latch, possession-is-auth, but
   document it). The WiFi-fail rescue case needs no new feature: the
   serial config menu already appears when WiFi can't connect.
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
   **Update 2026-07 (first bus-servo bench attempt, Scott):** building
   `bus-servos.ino` against the installed **SCServo by FT&WS** (Feetech/
   Waveshare, Library Manager) exposed that the SC path never compiled —
   `SCSCL` has **no `WheelMode`/`WriteSpe`** (STS-only; SC does continuous
   drive via `PWMMode`/`WritePWM`, different registers/units). Fixed the
   compile as a **warn-and-no-op** on the two SC continuous branches in
   `PardaloteBusServo.h` (`writeSpeed`, `setMode` wheel) — STS path untouched.
   **Still to do:** implement the real SC `PWMMode`/`WritePWM` continuous
   mapping when an SC servo is on the bench (speed→PWM scaling is a guess
   without hardware). All other `_sc.*` calls were cross-checked against the
   installed lib and are present, so this was the only SC compile gap.
6b. **Revisit: does the basic PWM servo need to be an extension?** (Scott,
   2026-07 — parked.) Prompted by uploading `servo-control` (PWM servo,
   `DEVICE_SERVO 201`) while the browser ran `bus-servos` (`DEVICE_BUSSERVO
   206`) → board printed `Unknown extension deviceId: 206` and nothing moved,
   because an extension only self-registers when its header is `#include`d.
   The basic servo being an opt-in extension is a sharp edge for the simplest
   actuator; consider folding plain PWM-servo support into the core (or
   otherwise softening the wrong-sketch failure mode). Not now — design
   discussion only.
7. ~~**Sketch-created steppers & bus servos**~~ — **DONE**, and since
   extended to **NeoPixel, Ultrasonic, and IMU** (see the framework-
   completion entry under What's built). Every multi-instance device now
   has a sketch-side `attach(name, …)` + `registerExtensionType`. **Camera
   is the only device still browser-only** (singleton, ESP32-only) —
   deferred by choice. The **sketch-created** path is still unrun on hardware
   (Phase 8 stepper/bus servo, and 9.3/10.2/11.4 for NeoPixel/Ultrasonic/IMU) —
   though the browser-driven versions of those devices are now confirmed on ESP32.

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
- `lib/` — browser library: generated `pardalote.js` bundle + per-board pin
  aliases at the root; modular sources (`pardalote-core.js` + one per extension)
  in `lib/src/`. Built by `build_pardalote.py`.
- `pardalote-arduino/library/Pardalote/src/` — firmware: `Pardalote.{h,cpp}`,
  `Pardalote<Extension>.h`, `internal/{defs,protocol,extensions,…}`.
- `examples/` — browser (p5.js) examples. `…/examples/*/` (IDE) — minimal `.ino`s.
