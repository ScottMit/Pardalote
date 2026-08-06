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

A board started with `Pardalote.begin("robot-arm-3")` only completes the handshake for clients that present the same key — an opt-in latch against connecting to a neighbour's board on a shared classroom network. A client with the wrong key (or none) receives one `'authFail'` event with a readable message and auto-reconnect stops, so a typo surfaces as a single clear error rather than a silent retry loop.

The key is an accident-prevention measure, **not security**: it crosses the network unencrypted (`ws://`). Boards started without a key accept everyone.

## connectSerial()

Connects over the USB cable instead of WiFi, using the browser's Web Serial API (Chrome and Edge only, including Chromebooks). WiFi is the default but the Arduino sketch can select serial explicitly with `Pardalote.begin(PARDALOTE_SERIAL)`. The one exception is the UNO R4 Minima — it has no radio, so every `begin()` form starts the serial transport, the only one that hardware can have. Everything downstream of connecting is identical to WiFi, so a project can migrate between the two by changing one line on each side. There is no key concept over serial: holding the cable is access.

<div class="sig">arduino.<span class="fn">connectSerial</span>([options])</div>

| Parameter | Type | Description |
|---|---|---|
| `options` | object | Optional. `{ prompt: true }` forces the browser's port picker even when a previously granted port exists. |

```javascript
connectButton.addEventListener('click', () => {
    arduino.connectSerial();   // first time: Chrome shows a port picker
});
```

Notes:

- The **first** call must come from a user gesture (a click) — the browser requires it for the port picker. The permission is remembered, so a returning visit can call `connectSerial()` without a gesture and reconnect silently.
- The sketch's `Serial.print` output is delivered to the page as the `'log'` event, one line per event (with no listener it goes to the console prefixed `[board]`) — debug prints are visible without opening the Arduino IDE. Avoid `Serial.write` of raw binary from the sketch; text is fine.
- The camera extension needs WiFi (its video travels over HTTP); everything else works over serial.
- Multi-browser sharing is a WiFi feature — a USB cable has one end.

## on()

Registers a handler for a connection event.

<div class="sig">arduino.<span class="fn">on</span>(event, handler)</div>

| Parameter | Type | Description |
|---|---|---|
| `event` | string | One of `'ready'`, `'connect'`, `'disconnect'`, `'reconnecting'`, `'authFail'`, `'log'`, `'warn'`, `'error'`. |
| `handler` | function | Called when the event fires. `'reconnecting'` receives `{ attempt, delay }`; `'authFail'` receives `{ reason, message }`; `'log'` receives a string; `'warn'`/`'error'` receive `{ source, message }`. |

| Event | Fires when |
|---|---|
| `'ready'` | The Arduino has connected **and** sent its current state — pins, extensions, pixel colours. Do your setup here. |
| `'connect'` | The WebSocket opens — before `ready`. |
| `'disconnect'` | The connection is lost. |
| `'reconnecting'` | A reconnect attempt is scheduled; the next retry is in `delay` ms. |
| `'authFail'` | The board refused this client's connection key (or required one that wasn't sent). Auto-reconnect stops — call `connect()` again with the right key. |
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
