title: Connecting
lede: Opening the connection from JavaScript — WiFi or USB serial — plus connection keys, events, reconnection, and status.
---
All examples assume `const arduino = new Arduino();`.

## connect()

Opens a WebSocket connection to the Arduino. Call once; reconnection after drops is automatic.

<div class="sig">arduino.<span class="fn">connect</span>(ip, [portOrOptions])</div>

| Parameter | Type | Description |
|---|---|---|
| `ip` | string | The Arduino's IP address, e.g. `'192.168.1.42'`. Shown on the LED matrix (UNO R4) or in the Serial Monitor (ESP32). |
| `portOrOptions` | number \| object | Optional. A number is the WebSocket port (default `81`). An object accepts `{ port, key }` — `key` is the board's connection key (see below). |

```javascript
arduino.connect('192.168.1.42');                         // WebSocket on port 81
arduino.connect('192.168.1.42', 8081);                   // custom port
arduino.connect('192.168.1.42', { key: 'robot-arm-3' }); // board requires a key
```

Calling `connect()` (or `connectSerial()`) again starts a fresh session: pin modes, polled reads, and write listeners from the previous board are cleared. Each registered extension is reset to its just-constructed state, so attached servos, initialised strips, IMU calibration and camera streams are released — call `attach()` / `init()` again inside the new `on('ready')` handler. Event listeners attached with `on('change', …)` etc. survive, as do user-tuned settings like `setWriteThrottle`, `setWriteThreshold` and `setQuality`.

### Connection keys

A board that called [`Pardalote.requireKey("robot-arm-3")`](arduino.html#pardaloterequirekey) before `begin()` only completes the handshake for clients that present the same key — pass it as `connect(ip, { key: "robot-arm-3" })` or `connectSerial({ key: "robot-arm-3" })`. A client with the wrong key (or none) receives one `'authFail'` event with a readable message and auto-reconnect stops, so a typo surfaces as a single clear error rather than a silent retry loop.

The key works over **both** transports. Over WiFi it's a latch against connecting to a neighbour's board on a shared classroom network. Over USB — where the cable already picks the board — it's a **board-identity check**: a student who grabbed the wrong physical board gets "wrong key for this board" instead of silently driving it. Either way it's an accident-prevention measure, **not security**: it crosses the wire unencrypted (`ws://`, or in the clear over USB). Boards that never call `requireKey()` accept everyone.

## connectSerial()

Connects over the USB cable instead of WiFi, using the browser's Web Serial API (Chrome and Edge only, including Chromebooks). Everything downstream of connecting is identical to WiFi, so a project can migrate between the two by changing one line on each side. Which boards accept a USB connection depends on how the sketch called `begin()`: `begin()` (the default) and `begin(PARDALOTE_SERIAL)` both do; `begin(PARDALOTE_WIFI)` does not. On a UNO R4 Minima every form is serial (no radio).

<div class="sig">arduino.<span class="fn">connectSerial</span>([options])</div>

| Parameter | Type | Description |
|---|---|---|
| `options` | object | Optional. `{ prompt: true }` (also exported as `PROMPT`) forces the browser's port picker even when a previously granted port exists. `{ key }` sets the board's [connection key](#connection-keys). |

```javascript
connectButton.addEventListener('click', () => {
    arduino.connectSerial(PROMPT);   // Chrome shows a port picker
});
```

Notes:

- The **first** call must come from a user gesture (a click) — the browser requires it for the port picker. The permission is remembered, so a returning visit can call `connectSerial()` without a gesture and reconnect silently. Tool examples pass `PROMPT` so every click raises the picker.
- The sketch's `Serial.print` output is delivered to the page as the `'log'` event, one line per event (with no listener it goes to the console prefixed `[board]`) — debug prints are visible without opening the Arduino IDE. Avoid `Serial.write` of raw binary from the sketch; text is fine.
- The camera extension needs WiFi (its video travels over HTTP); everything else works over serial.
- Multi-browser sharing is a WiFi feature — a USB cable has one end.

### Switching to USB

A board started with the default `begin()` runs on WiFi but also listens on USB. Connecting over USB with `connectSerial()` makes the board **drop WiFi and switch to the cable** — handy when there's no WiFi handy or you just want a quick, direct session. It's one-way: to go back to WiFi, reset the board.

The switch only happens on a **deliberate user gesture** — a `connectSerial()` called in response to a real click (whether or not a port picker appears; a click that silently reuses an already-granted port still counts). An **automatic** connect with no user action — a page reloading and reconnecting, or a background tab — will **not** pull a board off WiFi; instead the page gets a `'usbBusy'` event meaning "this board is on WiFi — click Connect to switch it to USB." This keeps a background tab, or a board that's merely cabled for power, from yanking a shared WiFi board away from everyone else.

On a classic ESP32, opening the USB port resets the board (a hardware auto-reset the firmware can't decline), so the switch is really *reboot → WiFi → switch to USB*, a few seconds. On the UNO R4's native USB there's no reset — the handoff is immediate. A board started with `begin(PARDALOTE_WIFI)` ignores USB entirely; a `connectSerial()` attempt gets no reply and the console notes it may be a WiFi-only board.

## on()

Registers a handler for a connection event.

<div class="sig">arduino.<span class="fn">on</span>(event, handler)</div>

| Parameter | Type | Description |
|---|---|---|
| `event` | string | One of `'ready'`, `'connect'`, `'disconnect'`, `'reconnecting'`, `'authFail'`, `'usbBusy'`, `'log'`, `'warn'`, `'error'`. |
| `handler` | function | Called when the event fires. `'reconnecting'` receives `{ attempt, delay }`; `'authFail'` and `'usbBusy'` receive `{ …, message }`; `'log'` receives a string; `'warn'`/`'error'` receive `{ source, message }`. |

| Event | Fires when |
|---|---|
| `'ready'` | The Arduino has connected **and** sent its current state — pins, extensions, pixel colours. Do your setup here. |
| `'connect'` | The WebSocket opens — before `ready`. |
| `'disconnect'` | The connection is lost. |
| `'reconnecting'` | A reconnect attempt is scheduled; the next retry is in `delay` ms. |
| `'authFail'` | The board refused this client's connection key (or required one that wasn't sent) — over WiFi or USB. Auto-reconnect stops — reconnect with the right key. |
| `'usbBusy'` | Serial only: a `connectSerial()` without a picker gesture reached a board that's live on WiFi, which won't switch silently. Auto-reconnect stops — click Connect (which raises the picker) to switch it to USB. See [switching to USB](#switching-to-usb). |
| `'log'` | Serial transport only: one line of the sketch's `Serial.print` output. |
| `'warn'` | Something went wrong but Pardalote carried on — a write to an unattached servo, an oversized message key, a pong timeout. `source` says who's speaking (`"Pardalote"`, `"Servo 'pan'"`, `"Group 'arm'"`). |
| `'error'` | Something failed — a send error, a camera snapshot failure. Device errors also fire `'error'` on the device instance itself. |

Every emitter (the core, devices, pin handles) also has `once(event, handler)` — a one-shot listener that removes itself after firing — and `off(event, handler)` to unsubscribe (`handler` omitted: remove all).

```javascript Example — connection events
arduino.once('ready', () => {
    arduino.pinMode(13, OUTPUT);   // attach, init, start polls here
});
arduino.on('reconnecting', ({ attempt, delay }) => {
    console.log(`retry ${attempt} in ${delay} ms`);
});
```

## Warnings and errors in your UI

Every warning and error in the library funnels through the `'warn'` and `'error'` events, so a page can surface problems where users will actually see them — a status banner instead of a devtools console nobody has open:

```javascript Example — surface problems on the page
arduino.on('warn',  ({ source, message }) => showBanner(`${source}: ${message}`));
arduino.on('error', ({ source, message }) => showBanner(`${source}: ${message}`, 'red'));
```

If you never subscribe, messages fall back to `console.warn` / `console.error` exactly as before — the events are opt-in.

Any client connecting to a running system immediately sees the live state — that's what makes Pardalote multi-user by default.

## Automatic reconnection

Reconnection is automatic, with exponential backoff, and continues for as long as the page is open — you don't need to do anything. The first ten attempts are logged in the console; after that the library falls quiet. Subscribe to `'reconnecting'` for per-attempt updates. Silent auto-reconnect to the same Arduino preserves all state.

## disconnect()

Closes the connection and disables auto-reconnect.

<div class="sig">arduino.<span class="fn">disconnect</span>()</div>

## getStatus()

Returns a snapshot of the connection.

<div class="sig">arduino.<span class="fn">getStatus</span>()</div>

**Returns** `{ connected, isReconnecting, reconnectAttempts, deviceIP, availableExtensions }`.

## Properties

| Property | Type | Description |
|---|---|---|
| `arduino.connected` | boolean | `true` after `'ready'`. |
| `arduino.board` | string | Board name from the HELLO handshake, e.g. `'UNO R4 WiFi'`. |
| `arduino.analogMax` | number | ADC range: `1023` (UNO R4 WiFi / Minima) or `4095` (ESP32). |

See also: [Pins and reading](pins.html) · [Extensions overview](extensions.html)
