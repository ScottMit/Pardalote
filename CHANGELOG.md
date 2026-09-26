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

## [1.3.0] — 2026-09-26

- **Pin writes are safe in a draw loop — `digitalWrite()` joins the write throttle.**
  A changed `digitalWrite()` value still goes out immediately (so a short pulse is
  never lost), but writing the **same** value again — `digitalWrite()` or
  `analogWrite()` — is now re-sent at most every 250 ms per pin. A draw loop that
  writes a pin every frame drops from ~60 messages/s (plus a board echo of each) to
  ~4, while still re-asserting the browser's value if the board sketch or another
  browser changed the pin. Tune with the new `setWriteRepeat(ms)` (`0` = send every
  repeat). `analogWrite()`'s 20 ms change-coalescing is unchanged.
- **No write backlog on reconnect.** While disconnected, `digitalWrite()` /
  `analogWrite()` only record the latest value per pin instead of queueing every
  call; the reconnect replay sends each pin's value once. Previously a draw loop
  queued ~60 writes per offline second and flushed them as one burst on reconnect,
  which could starve the board's heartbeat reply and drop the link again. The replay
  now also restores `analogWrite()` duties (it used to restore only digital levels).
- **Camera: `snapshot()` works while a stream is running.** The board's web server
  runs one request at a time and a stream never finishes, so a snapshot on the
  stream's port waited until the stream closed (and failed if the page closed).
  Snapshots now have their own small server on the next port (`attach(82)` → `83`,
  stepping over the WebSocket's `81`), as in Espressif's CameraWebServer. The board
  reports the port when you `attach()`; mixed versions still work — older JS keeps
  using the stream port (still blocked mid-stream), and new JS on older firmware
  falls back to it.
- **Camera: `setResolution()` gave the wrong size on ESP32 core 3.x.** The JS sends
  each `FRAMESIZE_*` as a number, which the firmware passed straight to the camera
  driver. The driver in core 3.x added two sizes (`128X128`, `320X320`) that shift
  its numbering, so every size above QQVGA came out one or two places off —
  `FRAMESIZE_VGA` streamed 400×296, `FRAMESIZE_HD` 800×600. The firmware now maps each
  code to the driver's size by name, so all JS versions get the size they ask for.
  Update the Arduino library; no sketch changes needed.
- **Camera example: no black band after a resolution change.** p5's `createImg()`
  records an image's size from its first frame only, so after switching to a size
  with a different shape `image()` left a black band at the bottom. The
  camera-stream example (and the doc snippets) now copy the frame's real size into
  the element before drawing.
- **Camera: JPEG frame buffers sized for the largest frame.** The camera driver
  sizes each JPEG buffer once, at start-up, at width × height ÷ 5 of the start-up
  resolution, so a later `setResolution()` to a bigger size, or a detailed scene at
  high quality, could overflow it and drop frames (`cam_hal: FB-OVF`). With PSRAM
  and a hardware-JPEG sensor, the camera now starts at 1600×1200 (UXGA) and then
  switches to the requested size, as Espressif's CameraWebServer does, reserving
  ~770 KB of PSRAM. Software-JPEG sensors and boards without PSRAM are unchanged.
- **Camera: a console warning when another page is already streaming.** The board
  sends one stream at a time, so a second window's video used to stay blank with no
  explanation. The board now reports how many streams it's serving when you
  `attach()`, and the JS warns on a page's first `attach()` if one is already
  running. (Older firmware reports nothing, so no warning.)
- **Camera: sensors without hardware JPEG now stream.** Some ESP32 camera boards
  (e.g. Freenove ESP32-S3 CAM) ship a GC2145 / GC0308 sensor that can't output JPEG,
  which failed with `Init failed: 0x106`. `PardaloteCamera.h` now falls back to RGB565
  and JPEG-encodes each frame in software — the browser sees the same MJPEG stream.
  Serial names the detected sensor. Software encoding is slower, so keep those boards
  at QVGA/HVGA; OV2640/OV3660/OV5640 boards are unaffected.

## [1.2.0] — 2026-09-23

- **Reshape a gesture as it plays — `scale` · `speed` · `crop`.** Any gesture can be
  amplitude-scaled, sped up or slowed, or cropped to a slice of its timeline without
  editing its segments — so one authored motion reads gentle or emphatic, fast or slow.
  Pass `{ scale, speed, crop }` as opts to any `gesture()` (`speed`/`crop` global,
  `scale` a number or a per-lane `{ name: k }` map), or build a reusable, immutable
  chainable value with `arduino.makeGesture(spec)`:
  `head.gesture(nod.scale(0.7).speed(0.5).crop(0.2, 0.8))`. `scale` multiplies a
  relative `by` directly and scales an absolute `to` around the lane's starting target
  (`origin + (to − origin) × k`), so it works on either reference frame. `crop` also
  works on either frame — it slices a clipped segment by the curve fraction, keeping a
  relative delta or landing an absolute target at its eased mid-position — reusing the
  same easing maths the board mirrors, so a cropped shape reads identically on
  hardware; a cropped relative gesture ends off-home (`Gesture.cropped` flags it). Applied in the
  browser and sent as an ordinary gesture frame — **no API break, no wire change.**
  The board mirrors it for sketch-authored gestures: a `PardaloteGestureMod` on
  `PardaloteServo.gesture(...)` (and the stepper / bus-servo twins), or
  `Pardalote.gesture().scale().speed().crop().play()` on the coordinated builder
  (with per-lane `laneScale`). The transform runs at gesture start over the RAM
  segment copy — no extra buffer — and is **byte-identical to the browser** (a
  parity check in `tools/stub-compile/` diffs the two on every run).
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
  IDE examples **`board-gestures-PWM-servos`** and **`board-gestures-bus-servos`**
  (the former renamed from `board-gestures`) — a two-servo creature head that idles
  and reacts to a button, entirely on the board; each press steps through the same
  react reshaped by scale / speed / crop, to show the mods on hardware. Bus servos
  got a headless `PardaloteBusServo.configureBus(rxPin, txPin[, serial][, baud])`
  (the board-side twin of the browser's `configureBus`) so a sketch can set the
  ESP32 bus UART with no browser.
- **Gesture-active visibility (protocol v1.1).** A playing schedule now broadcasts a
  lightweight `CMD_*_GESTURE_STATE [id, active]` (`0x64`/`0x65`/`0x66`) on its start
  and end — **existence, never the schedule** — so every browser reflects an
  `isGesturing` flag and `gesturestart` / `gestureend` events, and a browser
  reconnecting mid-gesture learns the state on sync. It fires whoever authored the
  gesture — another browser or the sketch — making board- and browser-authored
  gestures equally visible. Backward-compatible: older clients ignore the new code
  (protocol MINOR 0 → 1, no MAJOR break).
- **Bus servos now render easing curves on the board.** A `gesture()` on a Feetech
  bus servo used to ignore the segment's `curve` — the servo drew a plain velocity
  ramp per segment, so authored easing and overshoot were lost (the old docs told you
  to fake a shape by decomposing it into more segments). The board now runs a
  **streaming interpolator**: it samples the eased curve on a fixed clock and streams
  look-ahead setpoints (batched across a group into one phase-locked `SyncWrite`),
  paced to the servo's real position so a move can't run ahead of the hardware and
  drift. The shape you author — `easeIn` / `easeOut` / `easeInOut` / `back`, overshoot
  included — is the shape the servo runs, and each move lands on its authored timeline.
  (A segment shorter than ~600 ms plays linear — too brief to render an easing shape, and
  imperceptibly so.) No API or wire-format change. In a coordinated group, the lanes stay phase-locked even
  when one servo can't keep up: the whole gesture waits for its slowest channel and stays
  in formation, rather than the fast lanes running on and tearing the pose apart.
  *(All five curves + the multi-servo group barrier bench-confirmed on ST servos.)*
- **WiFi connect no longer waits at boot, and retries forever.** The 5-second
  "press `w`" window is gone: the board starts connecting straight away, trying each
  network (secrets.h, then EEPROM) for 10 s and looping back to the first one
  indefinitely instead of stopping in the config menu. Press `w` at any point during
  connecting to open the menu. Connecting stays paused until you exit with `x`, then
  restarts from the first network. A board that boots before its router is ready now
  joins once the network is up, with no one at the keyboard.

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
