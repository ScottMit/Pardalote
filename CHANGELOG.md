# Changelog

All notable changes to Pardalote are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/); versions follow
[Semantic Versioning](https://semver.org/).

Pardalote versions **two things independently**:

- **Product version** (this file, `library.properties`, `package.json`) —
  the release humans see. The Arduino library and `pardalote-js` ship in
  lockstep under one number. MAJOR = breaking JS API or a protocol change
  old clients can't survive; MINOR = backward-compatible features;
  PATCH = fixes.
- **Protocol version** (`PROTOCOL_VERSION_MAJOR/MINOR` in `defs.h`,
  carried in the HELLO handshake) — the wire-compatibility contract
  between any JS build and any firmware build. The JS side checks it on
  connect and reports a MAJOR mismatch on the `error` channel.

## [Unreleased]

- **Sketch-authored gestures — the board composes motion too.** Following the rule
  that whoever speaks is in control, the Arduino side gains the full gesture surface
  the browser already had, so a sketch can run expressive motion with **no browser**.
  `PardaloteServo.gesture(id, segs, count)` (and the stepper / bus-servo twins) plays
  an authored `PardaloteSeg[]` segment schedule on the board's own clock — the same
  on-board player and byte-identical result as a browser-authored gesture. Segments
  are `{ curve, dur, value }` in the actuator's native unit, absolute by default; a
  `static const PardaloteSeg[]` lives in flash (32-bit boards) at zero RAM cost.
- **Coordinated one-shot actions from the sketch.** `Pardalote.gesture()` is the
  board-side twin of `arduino.gesture()` — add one lane per actuator by `DEVICE_*`
  id and `play()` them phase-locked, with shorter lanes padded to arrive together;
  it drives mixed actuator types through a decoupled, opt-in registry. `Pardalote.write()`
  and `Pardalote.writeTimed(dur)` mirror `arduino.write()` / `arduino.writeTimed()`
  for immediate and arrive-together coordinated moves. `onGestureDone(id, cb)` is the
  board-side `whenDone()`, so a headless sketch can chain gestures into a sequence.
  New IDE example **`board-gestures`** — a two-servo creature head that idles and
  reacts to a button, entirely on the board.
- **Gesture-active visibility (protocol v1.1).** A playing schedule now broadcasts a
  lightweight `CMD_*_GESTURE_STATE [id, active]` (`0x64`/`0x65`/`0x66`) on its start
  and end — **existence, never the schedule** — so every browser reflects an
  `isGesturing` flag and `gesturestart` / `gestureend` events, and a browser
  reconnecting mid-gesture learns the state on sync. It fires whoever authored the
  gesture — another browser or the sketch — making board- and browser-authored
  gestures equally visible. Backward-compatible: older clients ignore the new code
  (protocol MINOR 0 → 1, no MAJOR break).

## [1.1.0] — 2026-08-17

- **Named pins are now built in.** `D13`, `A0`, `SDA`, `LED_BUILTIN` and friends
  work by name in any sketch with nothing extra to include — each is a global
  string equal to its name (`D13 === 'D13'`), resolved to the right physical pin
  **per board, per `Arduino()` instance** when the `ready` event fires (so two
  boards can resolve the same `D13` differently). They install as guarded
  `globalThis` properties, so they never throw a redeclaration error and step
  aside for any name you've already defined; `<script src="pardalote.js"
  data-pins="off">` disables them entirely. Bare `D13` and the string `'A0'` are
  identical — the globals just save the quotes.
- **Removed the standalone `pardalote-pins-*.js` board files.** Superseded by the
  built-in named pins above; the pin data now lives once in `BOARD_ALIASES` in
  the core and feeds both the string form and the bare globals.
- **License:** adopted the current SPDX identifier `GPL-3.0-or-later` (was the
  deprecated `GPL-3.0`) across `library.properties`, `package.json`, and every
  source-file notice. The GPLv3 LICENSE text is unchanged.
- **Repo layout:** the browser JavaScript moved from `pardalote-js/` + `dist/`
  into a single `lib/` folder — the generated bundle is now `lib/pardalote.js`
  and the modular sources moved to `lib/src/`. Examples and `build_pardalote.py`
  updated to match.
- **JS release package:** `pardalote-js-<ver>.zip` now ships the runnable
  `examples/` and a `LICENSE` alongside the bundle, laid out so the examples run
  straight from the download.
- **Removed the `expressive-gesture` example** from the website gallery and the
  JS release package (it remains in git history).

## [1.0.0] — 2026-08-14

First release. Everything before this was unversioned beta; earlier
internal numbers (v2.x folder names, a transitional "protocol v1.1")
have no meaning outside the development history.

**Protocol: v1.0.**

### The system

- Browser JS ⇄ Arduino over a compact binary protocol — the same
  frames over WiFi (a WebSocket) or over a USB cable (Web Serial).
  Arduino-mirroring verbs (`pinMode`, `digitalWrite`, `analogRead`, …)
  are safe to call every frame of a p5.js draw loop — reads return a
  local mirror, kept live by the board. Multi-user by default: every
  connecting browser receives full state before `ready`, and all
  browsers (and the sketch) stay in sync.
- Extensions — each an opt-in Arduino `#include`; on the JS side they
  all ship in the one bundle: **Servo**,
  **Stepper**, **Bus servo** (Feetech ST/SC), **NeoPixel**,
  **Ultrasonic**, **IMU**, **Camera** (ESP32), **Rotary encoder**.
  Coordinated multi-actuator moves via **Groups** (arrive-together
  `writeTimed`, awaitable `whenDone()`). A typed key/value **message
  channel** with retained values, plus a frame monitor on both sides.
- Sketch-side parity: `share()` pins, sketch-created devices
  (`PardaloteServo.attach("pan", 9)` → `arduino.pan` in every browser),
  WiFi provisioning, boot-id reconnect semantics.
- **USB serial transport** — `arduino.connectSerial()` (Web Serial;
  Chrome/Edge) carries the same binary protocol over the USB cable: no
  network, no IP, one-line migration to WiFi. COBS-framed with a CRC8, so
  the sketch's `Serial.print` output coexists on the wire and reaches the
  page as the `'log'` event. Adds **UNO R4 Minima** support (serial-only).
  Camera excepted (its video is an HTTP stream).
- **`begin()` listens for both, one-way switch to USB** — the default
  `begin()` runs WiFi **and** listens on USB; a deliberate (port-picker
  gesture) `connectSerial()` makes the board drop WiFi and switch to the
  cable (one-way; reset to return). `begin(PARDALOTE_WIFI)` opts out of the
  USB listen; `begin(PARDALOTE_SERIAL)` is USB only. The switch requires a
  gesture — a silently reused port fires `'usbBusy'` and won't pull a board
  off WiFi, so a background tab or a power-only cable can't grab a shared
  board. Wire: `CMD_SERIAL_BUSY 0x0D` + a takeover flag on the HELLO probe.
- **Reset-while-USB auto-recovery** — the board emits a `CMD_REBOOT` marker over
  serial at boot; a browser still holding the port resumes probing and the board
  switches straight back to USB (no click). Serial takeover authority persists
  across a gesture session's reconnects so the recovery can re-switch (a fresh
  page load still starts without it — a background tab can't grab a WiFi board).
  Wire: `CMD_REBOOT 0x0E`.
- **Connection keys (opt-in), both transports** — `Pardalote.requireKey("key")`
  before `begin()` + `arduino.connect(ip, { key })` / `connectSerial({ key })`.
  Wrong/missing key → one `'authFail'` event and auto-reconnect stops. Over
  WiFi a latch against the wrong board on a shared network; over USB a
  board-identity check that catches "grabbed the wrong board". An
  accident-prevention latch, not security (cleartext). Wire: `CMD_AUTH 0x0C`,
  folded into protocol v1.0 pre-release. (Replaces the earlier `begin("key")`
  form.)

### JavaScript distribution

- **`dist/pardalote.js` is the all-in-one bundle** — the core plus every
  device extension (Servo, Stepper, BusServo, NeoPixel, Ultrasonic, IMU,
  Encoder, Camera), and the single file a sketch includes. It's generated
  from the modular sources in `pardalote-js/` (`pardalote-core.js` plus one
  `pardalote-<device>.js` each) by `build_pardalote.py`. The Arduino side
  stays modular — extensions are opt-in `#include`s — because each pulls in
  its own third-party library and some are platform-gated; the browser has
  no such cost, so it bundles.
- **Why bundle the JS:** the p5.js Web Editor preprocesses each *separate*
  local file through esprima/escodegen and throws on the extension files as
  standalone programs; concatenated into one file they load cleanly. The
  bundle also collapses the old "core + extensions + sketch, in order" load
  dance to a single `<script>`. Board pin maps (`pardalote-pins-*.js`) are
  per-board and mutually exclusive, so they are never bundled.

### Notable design decisions (for readers of the beta code)

- **Looking is decoupled from telling.** Digital input pins are watched
  on every loop pass — edges transmit immediately with a 15 ms bounce
  lockout, so button taps are never lost and never wait for a timer.
  Analog pins are sampled every 10 ms. A browser's `interval` is a
  per-browser **rate limit**, not a sampling clock, and `threshold`
  defines a meaningful change (analog default: the ADC noise floor).
  All of it per-client: each browser gets its own interval, threshold,
  and last-seen value; idle pins transmit nothing.
- **Two-noun grammar.** Verbs for doing; handles and devices for
  listening. `arduino.pin(ref)` is the listening handle for a pin —
  `on('change', ({ value }) => …)` for input readings *and* output
  writes, `off()` to unsubscribe, per-pin config, lazy alias resolution
  (works before `ready`), listeners that survive board switches.
- **`change` is the sensor event everywhere** — the board only
  transmits meaningful changes, so the event means what it says.
- **`warn`/`error` events** on the core carry every library problem
  (`{ source, message }`), falling back to the console when nobody
  listens. Device errors also fire on the device instance.
- **Rotary encoders are counted in interrupts** (4x quadrature state
  table — debounce-free by construction); position streams as an
  absolute value under the normal rate limit.

- **Naming rules.** Event strings are lowercase words, with `:` for
  compound events (`home:fail`); methods are camelCase. Write-side pacing
  is the `setWrite*` family (`setWriteThrottle`, `setWriteThreshold`),
  inbound gating the `setRead*` family. Command-echo events carry the
  destination (`move` → `{ target }`, always). Questions are promises
  (`servo.attached()`, `busServo.ping()`), never events. Every emitter
  has `on`/`off`/`once`.

### Removed during beta (never released, listed for anyone tracking)

- The `'read'` event and `onRead()` (→ `'change'` / `onChange()`).
- `arduino.onChange(pin, cb)`, `arduino.onWrite(pin, cb)`,
  `arduino.offWrite(pin)` (→ `arduino.pin(ref)` handles).
- JS-side polling timers in extensions (→ board-side per-client
  registrations).
- The `'attached'` event and `onAttached()` (→ `await servo.attached()`);
  the `'homeFail'` spelling (→ `'home:fail'`); servo/NeoPixel
  `setThrottle`/`setThreshold` (→ `setWriteThrottle`/`setWriteThreshold`).
