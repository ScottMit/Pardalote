# Plan — `begin()` listens for both, one-way switch to USB (classroom-safe)

Implementation spec for the transport change discussed 2026-08. **Not yet
built.** Written against the current code; symbols and line numbers cited so it
can be picked up cold. Read [PROJECT-STATUS.md](PROJECT-STATUS.md) loose-end 1b
first — this is the *deferred concurrent-transport* idea, deliberately narrowed.

---

## 1. Goal

`begin()` should leave the board reachable over **either** WiFi **or** USB,
without the sketch choosing up front. Only one transport is ever *active* at a
time — there is **no** concurrent dual-transport (that was dropped: big headache,
little payoff; WiFi already gives multi-client). When a browser deliberately
connects over USB, the board **drops WiFi and takes the USB link**. One
direction only; to go back to WiFi, reboot.

The `_transport` flag stays a single value (`TRANSPORT_WIFI` **or**
`TRANSPORT_SERIAL`). This feature adds a *runtime WiFi→serial transition*, not a
second live transport, so none of the per-client-routing / client-slot-collision
cost of the concurrent design applies.

### `begin()` forms

| Form | Behaviour |
|---|---|
| `begin()` | WiFi + WebSocket **and** sniff USB for a takeover. Default. |
| `begin(PARDALOTE_WIFI)` | WiFi only. **Does not** sniff USB — the opt-out for "nobody grabs my board over the cable." **New token.** |
| `begin(PARDALOTE_SERIAL)` | USB only, WiFi never started. Unchanged. |
| Minima (`PARDALOTE_NO_WIFI`) | Always serial. Unchanged. |

**Connection key** is set separately with `requireKey("key")` **before** `begin(...)`
— it composes with every form above (WiFi, WiFi-only, or serial). The old
`begin("key")` overload is **removed** (see §8.1). A keyed board demands the key
over **either** transport, so a wrong-key connection is caught over USB too — the
"grabbed the wrong board" catch.

---

## 2. The consent model (why the switch is safe)

The one real hazard is **silent recapture**: Chrome reuses an already-granted
port with no user gesture (`navigator.serial.getPorts()`), so a returning tab
could yank a WiFi board to USB with nobody touching anything — dropping every
other WiFi client. In a classroom where boards are often cabled just for power,
that's a live-fire footgun.

**Rule: a board leaves WiFi only on a deliberate picker gesture.** Web Serial
gives the distinction for free:

- `requestPort()` → **requires transient user activation** (the picker click). Genuine consent.
- `getPorts()` → silent, no gesture. The recapture vector.

So the switch is gated on a signal JS sends **only** after a real picker
gesture, and the firmware **will not drop WiFi without it**. Silent reuse can
still reconnect a board that is *already* on serial; it can never switch one off
WiFi. The guarantee lives in the firmware, so it holds regardless of what the
browser side (or a rogue/old page) does.

**The board cannot summon a picker** — only JS inside a live click can. And you
**cannot** "try silent first, then fall back to the picker" in one click: an
`await` round-trip to the board burns the user activation, after which
`requestPort()` throws. Therefore the flow decides *by trigger*, up front:

- **Connect click → `requestPort()` directly** (no silent attempt first). Picker
  appears every time inside the gesture; that *is* the feedback; the takeover
  succeeds in the same click.
- **Page load / auto-reconnect (no gesture) → silent `getPorts()`**, plain probe,
  no takeover authority.

---

## 3. Wire protocol additions

Core command space is `0x00`–`0x0C`; `0x0D`–`0x13` are free (servo starts
`0x14`). ([internal/defs.h](pardalote-arduino/library/Pardalote/src/internal/defs.h))

- **JS→Ar — takeover flag on the existing HELLO probe.** The serial probe is
  `encodeFrame(CMD_HELLO, 0, [])` today
  ([pardalote-core.js:509](pardalote-js/pardalote-core.js:509)). Add one param:
  - `CMD_HELLO` params `[]` or `[0]` → **plain probe** (reconnect only).
  - `CMD_HELLO` params `[1]` → **takeover-authorised probe** (gesture-backed).

  No new JS→Ar command byte. In serial-only mode the board ignores the flag (any
  probe already means "connect me"), so a gesture connect works against every
  serial board and old firmware is unaffected.

- **Ar→JS — `CMD_SERIAL_BUSY 0x0D` (new).** Sent by a WiFi-listening board that
  receives a *plain* probe: "I'm on WiFi — a picker gesture is required to switch
  to USB." Board stays on WiFi. JS surfaces it as an event and stops probing (no
  reconnect churn — same discipline as `authFail`).

Folded into protocol v1.0 pre-release (no version bump — v1.0 is unreleased),
matching how the connection key was added.

---

## 4. Firmware changes

### 4.1 Tokens & state
- `internal/defs.h`: add `#define PARDALOTE_WIFI 2` (API token, not a wire value;
  next to `PARDALOTE_SERIAL 1`). Add `#define CMD_SERIAL_BUSY 0x0D`.
- `Pardalote.h`: add `bool _serialListen = false;` (armed by `begin()`), and a
  `_frame_names.h` entry for `CMD_SERIAL_BUSY`.

### 4.2 `begin()` forms — [Pardalote.cpp:37](pardalote-arduino/library/Pardalote/src/Pardalote.cpp:37)
- `begin()`: `_beginWifi(); _serialListen = true;` (WiFi-capable boards).
- `begin(int transport)`: `PARDALOTE_SERIAL` → `_beginSerial()` (as now);
  `PARDALOTE_WIFI` → `_beginWifi()` with `_serialListen = false`;
  anything else → treat as default (`_beginWifi`, listen on).
- **Remove `begin(const char* key)`.** Keys now come from `requireKey()` (§4.2a).
  `_beginWifi()` reads the key already stashed in `_key`/`_keyRequired` (the same
  fields it set inline before), so the WiFi bring-up path is otherwise unchanged.
- Under `PARDALOTE_NO_WIFI` all forms still start serial (unchanged); `_serialListen`
  is irrelevant there.

### 4.2a `requireKey(const char* key)` — the one key API (new)
A `PardaloteClass` method called from `setup()` **before** `begin(...)`. Sets
`_key` + `_keyRequired` (the truncate-to-`PARDALOTE_KEY_MAX` + warn logic moves
here from `_beginWifi`, [Pardalote.cpp:109](pardalote-arduino/library/Pardalote/src/Pardalote.cpp:109)).
Orthogonal to transport, so it composes with `begin()`, `begin(PARDALOTE_WIFI)`,
and `begin(PARDALOTE_SERIAL)` alike — no `begin(transport, key)` overloads.
Called *after* `begin()` → warn on Serial and ignore ("call requireKey() before
begin()").

### 4.3 Listen + switch in `run()` — [Pardalote.cpp:146](pardalote-arduino/library/Pardalote/src/Pardalote.cpp:146)
When `_transport == TRANSPORT_WIFI && _serialListen`, service a **listen-mode**
serial decoder each loop (in addition to `_ws.loop()`):

```
if (_transport == TRANSPORT_WIFI) {
    _ws.loop();
    _platformLoop();
    if (_serialListen) _serialT.loopListen(millis());   // decode probes only
}
```

`_serialT.loopListen()` decodes envelopes but does **not** mark client 0
connected. On a fully-decoded, CRC-valid `CMD_HELLO` probe it calls back into the
core:
- **takeover flag set** → `_switchToSerial()`.
- **flag clear** → `_sendRaw`-equivalent of one `CMD_SERIAL_BUSY` envelope over
  `Serial` (board stays on WiFi). Serial is idle in the WiFi loop, so emitting one
  framed message commits to nothing.

Non-HELLO envelopes while listening are ignored.

### 4.4 `_switchToSerial()` (new)
1. Drop Pardalote's WiFi: disconnect every WS client through the existing
   `_onClientDisconnected(c)` path (fires extension disconnect hooks, clears
   per-client state), close/stop the WS server (`_ws.close()` — verify the
   arduinoWebSockets API; at minimum disconnect all clients so it stops serving),
   then `WiFi.disconnect()` to drop the association. **Leave the radio powered**
   — `WiFi.disconnect(false)` on ESP32 (do **not** `WIFI_OFF`), plain
   `WiFi.disconnect()` on R4. Rationale (§8.2): the sketch may want WiFi for its
   own use (HTTP/NTP/MQTT/etc.); Pardalote relinquishes the server and its own
   connection but doesn't scorch the radio. *(Implication: the association is
   dropped, so a sketch that wants WiFi re-establishes it itself — the radio being
   on is what makes that possible.)*
2. `_transport = TRANSPORT_SERIAL; _serialListen = false;`
3. Promote the decoder to full connected mode (`_serialT.begin(...)` with the
   connect/message/disconnect trampolines, [Pardalote.cpp:137](pardalote-arduino/library/Pardalote/src/Pardalote.cpp:137)).
   JS keeps probing every 500 ms, so the next probe drives the normal serial
   HELLO→announce→`SYNC_COMPLETE` handshake and client 0 comes up clean.
4. `Serial`-log the switch for the IDE monitor.

### 4.5 `serial_transport.{h,cpp}` — listen mode
Add `loopListen(now)` + a sniff-sink callback that reuses the existing COBS/CRC
decoder ([serial_transport.h:85](pardalote-arduino/library/Pardalote/src/internal/serial_transport.h)),
but routes a decoded message to the core's listen handler instead of the
connect/message sinks, and never sets `_connected`. A tiny helper to emit a
single framed message (`CMD_SERIAL_BUSY`) without full `begin()`.

### 4.6 `_sendRaw` — [Pardalote.cpp:952](pardalote-arduino/library/Pardalote/src/Pardalote.cpp:952)
Unchanged. Still routes by the single `_transport` flag; after `_switchToSerial()`
it's `TRANSPORT_SERIAL` and everything flows to `_serialT.send`.

---

## 5. JS changes ([pardalote-core.js](pardalote-js/pardalote-core.js))

### 5.1 `connectSerial(opts)` — gesture decides authority — [pardalote-core.js:989](pardalote-js/pardalote-core.js:989)
Track how the port was obtained and derive **takeover authority = port came from
`requestPort()` in this call** (which only succeeds inside a gesture):

- `connectSerial(PROMPT)` / no granted port → `requestPort()` → `authorized = true`.
- silent `getPorts()` reuse (page load / auto-reconnect) → `authorized = false`.

On a Connect **click**, call `requestPort()` **directly** — do not `await getPorts()`
or the board before it (preserves user activation). Pass `authorized` to the link.

### 5.2 `_SerialLink` probe carries the flag — [pardalote-core.js:508](pardalote-js/pardalote-core.js:508)
Constructor takes `takeover`; probe becomes
`encodeFrame(CMD_HELLO, 0, takeover ? [1] : [])`, sent on **every** 500 ms tick
(not just the first) so an ESP32 that DTR-reset on port open still sees the
takeover after it reboots into listen mode.

### 5.3 Handle `CMD_SERIAL_BUSY` — [pardalote-core.js:1406](pardalote-js/pardalote-core.js:1406)
New frame handler: stop the probe timer, close the port, **disable
auto-reconnect** (one clear signal, no churn — mirror `authFail`), and emit a new
`'usbBusy'` event meaning *"board is on WiFi — click Connect to switch to USB."*
Auto-reconnect (`_scheduleReconnect`, no gesture) therefore can never loop on a
WiFi board.

### 5.4 Auto-reconnect stays unauthorised
`_scheduleReconnect` → `_connectSocket` → `_connectSerialLink` has no gesture, so
its probes are plain; it can only re-attach a board still on serial. A board that
rebooted to WiFi answers `CMD_SERIAL_BUSY`, the page shows "click Connect," one
click resolves it. No silent switch is reachable from any non-gesture path.

### 5.5 "No response" probe hint (new) — [pardalote-core.js:508](pardalote-js/pardalote-core.js:508)
The serial probe loop currently probes forever with no give-up notice. Add a
grace timer: after ~4–5 s of probing with **no envelope received**, emit a
**one-time** console hint (via the `'log'`/console path) and keep probing (an
ESP32 that DTR-reset on port open may still be rebooting). Message lists the
likely causes, e.g.: *"No response from the board over USB yet. It may still be
booting, may not be running a Pardalote sketch, or may be **WiFi-only**
(`begin(PARDALOTE_WIFI)` boards don't accept USB)."* Covers decision 3 — a
WiFi-only board simply never answers, and this is the only feedback the browser
can give since the board isn't listening.

---

## 6. Example / UX changes
- Connection standard already uses `connectSerial(PROMPT)` → picker every click →
  authorised → switch works. No change needed for the happy path.
- Add a `'usbBusy'` listener to the tool template: set the Connect button to a
  clear **"Board on WiFi — click to use USB"** state instead of hanging.
- `begin(PARDALOTE_WIFI)` boards don't sniff serial at all → a USB attempt never
  gets a reply. The §5.5 probe hint is the feedback (lists WiFi-only as one likely
  cause among "still booting / not a Pardalote sketch"). No firmware nudge — a
  non-listening board can't answer. (Document the opt-out.)

---

## 7. What the user sees (feedback, every path)
- **Plug in, click Connect** → picker → pick board → connected over USB. WiFi
  drops. On ESP32 the port-open DTR-resets the board first, so it's reboot→WiFi→
  switch (~a few seconds); on R4 native USB it's a live handoff. Both land on USB.
- **Return visit, board rebooted to WiFi, page auto-tries USB silently** →
  `CMD_SERIAL_BUSY` → page shows "click Connect to use USB." One click fixes it.
  Never a silent dead-end.
- **Return visit, genuinely serial-only board** → silent reuse reconnects as today.

---

## 8. Open decisions for Scott
1. **Keyed board + USB — RESOLVED (2026-08).** Keys work over **both** transports.
   Set the key with a single new `requireKey("key")` method (§4.2a), called before
   `begin(...)`; it composes with every `begin()` form. **`begin(const char* key)`
   is dropped entirely** — one correct way, no `begin(transport, key)` overloads,
   no `begin("key")` sugar. Nothing is released, so no back-compat cost; the only
   fallout is docs (§10). A keyed board demands the key over USB too, so a
   wrong-key connection is refused with the existing
   `'connection refused — wrong key for this board'` console message
   ([pardalote-core.js:1533](pardalote-js/pardalote-core.js:1533)) and the board **stays on
   WiFi** — the "grabbed the wrong board" catch. Key is plaintext over the cable
   (as over `ws://`): a mismatch-catcher, not security. Effort: Tier 1 (~½ day) +
   the `requireKey()` setter (~1–2 hrs) — see the effort breakdown in the session
   notes. *Still to decide: 2 and 3 below.*
2. **Radio off on switch? — RESOLVED (2026-08).** On switch, drop the **WS server**
   and the **WiFi connection** (association), but **keep the radio powered** (do
   **not** `WIFI_OFF`) — the sketch may want WiFi for its own use. See §4.4.1.
3. **`PARDALOTE_WIFI` USB attempt — RESOLVED (2026-08).** A WiFi-only board does
   **not** sniff serial (confirmed intent). The browser gets no reply; JS logs a
   one-time hint after ~4–5 s (§5.5) listing likely causes, including "may be a
   WiFi-only board." No firmware nudge — a non-listening board can't answer.

**All §8 decisions resolved.** Ready to implement.

---

## Implementation status (2026-08)

**Code complete — firmware + JS.** Done:
- **Firmware** — `defs.h` (`PARDALOTE_WIFI`, `CMD_SERIAL_BUSY`, AUTH/transport
  comments); `serial_transport.{h,cpp}` (listen mode: `beginListen`/`loopListen`/
  `sendUnconnected`, `_listening` branch in `_envelopeDone`, factored
  `_writeEnvelope`); `Pardalote.h` (drop `begin(const char*)`, add `requireKey()`,
  `_serialListen`/`_begun`/`_listenAuthed`/`_listenKeyTried`, listen/switch method
  decls); `Pardalote.cpp` (`begin()`/`begin(int)` forms, `requireKey()`,
  `_beginWifi()` reads stashed key + arms listen, `run()` calls `loopListen`,
  `_onClientConnected` auth init `!_keyRequired`, auth timeout for both transports,
  `_rejectClient` via `_sendRaw` over both transports, `_switchToSerial` +
  `_handleListenMessage` + `_sendListenFrame` + `_serialListenTrampoline`);
  `frame_names.h` (`SERIAL_BUSY`).
- **JS** — `CMD_SERIAL_BUSY`; `connectSerial` gesture authority + `opts.key`;
  `_SerialLink(port, {takeover, key})` probe sends AUTH+HELLO(takeover flag) each
  tick; one-shot takeover (auto-reconnect stays plain); no-response hint;
  `_onUsbBusy` (→ `'usbBusy'`, disable reconnect); dispatch + events doc.

**Verified so far:**
- `serial_transport.cpp` stub-compiles clean (clang++ `-fsyntax-only`, minimal
  `Arduino.h`).
- **`Pardalote.cpp` + `serial_transport.cpp` stub-compile clean on
  `-DARDUINO_UNOR4_MINIMA`** (the `PARDALOTE_NO_WIFI` build) — confirms the guard
  changes (auth-timeout moved out of the WiFi guard, `_rejectClient` without `_ws`,
  the `begin`/`requireKey`/`_beginSerial` path, listen/switch code guarded out).
  The Minima build compiles the WiFi-only new functions *out*, so it does not
  cover them — that's deliberate: Minima is the target Scott won't bench-compile,
  so it's the one verified here; the ESP32/R4 compile (his real build) is the gate
  for `_switchToSerial`/`_handleListenMessage`/`_sendListenFrame`/`loopListen`
  arming. Their symbol usages were cross-checked against declarations.
- **Node harness, 13/13** against the real `pardalote.js` (`scratchpad/harness.mjs`):
  gesture probe carries takeover flag `[1]`; silent probe carries none; `{key}`
  sends an AUTH frame with the key alongside the takeover HELLO; `CMD_SERIAL_BUSY`
  → `'usbBusy'` + reconnect disabled; no-response hint fires once and is cancelled
  by a reply.
- `Pardalote.cpp` symbol usages checked against declarations (`Frame` fields,
  `paramInt`, `FrameBuilder`).

**Still outstanding (structural):** the ESP32/UNO-R4-WiFi compile of the WiFi
path — where the new listen/switch functions actually live. Deliberately left to
Scott's real bench compile (more authoritative than a stub; he builds for those
boards anyway). The Minima (`PARDALOTE_NO_WIFI`) compile is DONE here (see above).
Then docs (§10) and the bench pass (§9).

## 9. Verification (respect the structural-only caveat)
- **Host stub-compile** all firmware TUs + a sketch-shaped TU on `-DESP32`,
  `-DARDUINO_UNOR4_WIFI`, `-DARDUINO_UNOR4_MINIMA` (Minima path must ignore the new
  listen code cleanly under `PARDALOTE_NO_WIFI`).
- **Node harness** (extend the existing 43-assertion serial/auth harness):
  takeover-flag probe → switch path; plain probe → `CMD_SERIAL_BUSY` + no switch;
  authorised vs unauthorised `connectSerial`; `usbBusy` disables reconnect;
  C++⇄JS byte-compat for the new HELLO param and `CMD_SERIAL_BUSY` envelope.
- **Bench — ESP32-WROVER (2026-08, Scott):**
  - ✅ USB-only (`begin(PARDALOTE_SERIAL)`, no WiFi) connect + comms.
  - ✅ WiFi connect + comms.
  - ✅ **WiFi→USB switch works end-to-end**: click USB Connect → DTR reset →
    board reboots → WiFi back up → `Listening on USB` → `USB takeover — WiFi
    released` → serial `ready`. The headline feature is real-hardware confirmed.
  - 🐛 **Fixed (JS): stale heartbeat survived a transport switch → reconnect
    churn.** `_closeSocket()` nulls the socket's `onclose` before closing, so the
    `_stopHeartbeat()` that normally runs from `onclose` was skipped; the old
    transport's heartbeat kept ticking and, during the board's ~5–8 s reboot
    window (no pongs), fired "no pong → reconnect", tearing down the in-flight
    serial link (whose replacement had `takeover` already consumed → couldn't
    re-switch → WS/serial oscillation). Fix: `_closeSocket()` calls
    `_stopHeartbeat()` first. Regression test in `scratchpad/harness.mjs` (test G).
    **JS-only — no re-upload; re-test on the bench.**
  - 🐛 **Fixed (JS): a genuine click that reused a granted port didn't switch.**
    A bare `connectSerial()` from a click, on a *return* visit, reuses the granted
    port via `getPorts()` (no picker) — so `usedPicker` was false → `takeover`
    false → the board sent `usbBusy` even though the user clicked. Root cause: the
    model conflated "a picker appeared" with "the user acted." Fix: authorise the
    switch on **transient user activation** (`navigator.userActivation.isActive`,
    captured before any await) OR a picker — so a deliberate click authorises even
    when no picker shows, while a page-load/background auto-connect (no activation)
    still can't switch a WiFi board. Harness test B2. Docs reworded "picker
    gesture" → "user gesture (a click)". **JS-only — update the copy of
    `pardalote.js` in the sketch; no firmware re-upload.**
  - ⚠️ **Latent (not hit on WROVER): takeover one-shot may break the switch on a
    native-USB ESP32** (S3/C3 USB-CDC) where opening the port resets AND
    re-enumerates USB → the gesture link drops → auto-reconnect's link has
    `takeover` consumed (one-shot) → plain probe → `usbBusy`, stuck until a
    re-click. WROVER's CP2102 doesn't re-enumerate, so the gesture link persists
    across the reset and switches. Options in the report to Scott: persist
    takeover across a gesture-session's auto-reconnects (safe — a fresh page load
    still starts without it). **Decision pending.**
- **Boot-watch — fast switch (2026-08, FIRMWARE, needs re-upload).** Scott's WROVER
  switch worked but took ~13 s: the DTR reset reboots the board, which waits out
  the 5 s "press w" config window (ignoring the browser's probes), then tries WiFi
  (a stale stored SSID times out ~5-8 s), and only then arms the runtime listen and
  switches. Fix (Scott's idea): the config window now **also watches USB for a
  takeover probe**. A completed takeover during the window → skip WiFi entirely and
  go straight to serial (~1 s), no window wait, no failed-network timeout. Reuses
  the existing pause (no new boot delay) and happens before WiFi. Bytes go through
  the envelope decoder so a `'w'` only means config when it's loose text (not inside
  an envelope). `wifiConfigInit(s, probe)` + `_bootWatch`/`_bootTakeover` +
  `_handleBootByte`/`_bootProbeByte` + `_serialT.feedListen`/`decoderInText`.
  **Verified: ESP32 WiFi-path stub-compile clean (Pardalote.cpp, wifi_config.cpp,
  serial_transport.cpp) + Minima.** Bench TODO below.
- **Bench (remaining — must be done before 1.0):**
  1. ESP32 on WiFi, click USB Connect → reboot→switch, WiFi clients drop, ready over USB.
  2. R4 WiFi → live switch, no reboot.
  3. Board on WiFi cabled for power; return visit auto-probes silently → **stays on
     WiFi**, page shows "click Connect." (The classroom case — the whole point.)
  4. `begin(PARDALOTE_WIFI)` → USB attempt fails cleanly, WiFi untouched.
  5. Multi-client: 2 browsers on WiFi, a third deliberately switches to USB → the
     two WiFi clients disconnect as expected.

---

## 10. Docs to update — DONE (2026-08)

Swept: `arduino.md` (three `begin()` forms + new `requireKey()` section),
`connecting.md` (Connection keys rewritten for `requireKey`/both transports;
connectSerial gesture + `{key}`; new "Switching to USB" section; `usbBusy` in the
events table), `wifi.md` (lede mentions the USB switch), `troubleshooting.md`
(usbBusy, no-response/WiFi-only, wrong-key-over-USB, ESP32 switch-reboot),
`llms-preamble.md`, `README.md` (connect examples + USB-serial section + key
section), `CHANGELOG.md` (1.0.0 bullets: switch feature, `requireKey`, replaces
`begin("key")`). Header comments in `Pardalote.h`/`defs.h` updated in code.
Rebuilt `docs/reference/*.html` via `build_reference.py` and `llms*.txt` via
`build_llms.py` (both exit 0); cross-anchors (`#switching-to-usb`,
`#connection-keys`, `#pardaloterequirekey`) verified.

**Example UIs — DONE (2026-08).** `'usbBusy'` handling rolled into all seven tool
examples (servo-control, stepper-motor, coordinated-motion, control-panel,
bus-servos, messaging — single-board flag; leader-follower — per-board
`leaderUsbBusy`/`followerUsbBusy`): on a silent USB reconnect to a board that came
back on WiFi, the status now reads "board is on WiFi — press Connect to switch it
to USB" instead of a misleading "reconnecting…". All seven `node --check` clean.
Canonical snippet added to the connection-standard entry in PROJECT-STATUS.

### Original checklist
- **Drop `begin("key")` everywhere and replace with `requireKey("key")` +
  `begin(...)`.** References to fix (grep, 2026-08): comments in
  [Pardalote.h:114](pardalote-arduino/library/Pardalote/src/Pardalote.h:114) and
  [defs.h:99](pardalote-arduino/library/Pardalote/src/internal/defs.h:99); docs
  `docs-src/reference/arduino.md`, `connecting.md`, `messaging.md`,
  `llms-preamble.md`, and `README.md`. No example `.ino` uses it (only headers),
  so no sketch changes.
- `connecting.md` (connectSerial gesture rule, `usbBusy`, key over USB),
  `arduino.md` (the three `begin()` forms incl. `PARDALOTE_WIFI`, plus
  `requireKey()`), `wifi.md`, `troubleshooting.md` (ESP32 reboot-on-USB,
  "WiFi-only board can't be reached over USB", "wrong key over USB").
- CHANGELOG 1.0.0 bullet; reference index; rebuild HTML via `build_reference.py`.
- Add the canonical `'usbBusy'` handling to the tool-example connection-standard
  entry in PROJECT-STATUS.
```
