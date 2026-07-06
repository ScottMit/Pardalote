title: Connecting
lede: Opening the connection from JavaScript, connection events, reconnection, and status.
---
All examples assume `const arduino = new Arduino();`.

## connect()

Opens a WebSocket connection to the Arduino. Call once; reconnection after drops is automatic.

<div class="sig">arduino.<span class="fn">connect</span>(ip, [port])</div>

| Parameter | Type | Description |
|---|---|---|
| `ip` | string | The Arduino's IP address, e.g. `'192.168.1.42'`. Shown on the LED matrix (UNO R4) or in the Serial Monitor (ESP32). |
| `port` | number | Optional. WebSocket port. Default `81`. |

```javascript
arduino.connect('192.168.1.42');        // WebSocket on port 81
arduino.connect('192.168.1.42', 8081);  // custom port
```

Calling `connect()` again — for example, to switch to a different Arduino — starts a fresh session: pin modes, polled reads, and write listeners from the previous board are cleared so they aren't replayed onto the new hardware. Each registered extension is reset to its just-constructed state, so attached servos, initialised strips, MPU calibration and camera streams are released — call `attach()` / `init()` again inside the new `on('ready')` handler. Event listeners attached with `on('read', …)` etc. survive, as do user-tuned settings like `setThrottle`, `setThreshold` and `setQuality`.

## disconnect()

Closes the connection and disables auto-reconnect.

<div class="sig">arduino.<span class="fn">disconnect</span>()</div>

## on()

Registers a handler for a connection event.

<div class="sig">arduino.<span class="fn">on</span>(event, handler)</div>

| Parameter | Type | Description |
|---|---|---|
| `event` | string | One of `'ready'`, `'connect'`, `'disconnect'`, `'reconnecting'`. |
| `handler` | function | Called when the event fires. `'reconnecting'` receives `{ attempt, delay }`. |

| Event | Fires when |
|---|---|
| `'ready'` | The Arduino has connected **and** sent its current state — pins, extensions, pixel colours. Do your setup here. |
| `'connect'` | The WebSocket opens — before `ready`. |
| `'disconnect'` | The connection is lost. |
| `'reconnecting'` | A reconnect attempt is scheduled; the next retry is in `delay` ms. |

```javascript Example — connection events
arduino.on('ready', () => {
    arduino.pinMode(13, OUTPUT);   // attach, init, start polls here
});
arduino.on('reconnecting', ({ attempt, delay }) => {
    console.log(`retry ${attempt} in ${delay} ms`);
});
```

Any client connecting to a running system immediately sees the live state — that's what makes Pardalote multi-user by default.

## Automatic reconnection

Reconnection is automatic, with exponential backoff, and continues for as long as the page is open — you don't need to do anything. The first ten attempts are logged in the console; after that the library falls quiet. Subscribe to `'reconnecting'` for per-attempt updates. Silent auto-reconnect to the same Arduino preserves all state.

## getStatus()

Returns a snapshot of the connection.

<div class="sig">arduino.<span class="fn">getStatus</span>()</div>

**Returns** `{ connected, isReconnecting, reconnectAttempts, deviceIP, availableExtensions }`.

## Properties

| Property | Type | Description |
|---|---|---|
| `arduino.connected` | boolean | `true` after `'ready'`. |
| `arduino.board` | string | Board name from the HELLO handshake, e.g. `'UNO R4 WiFi'`. |
| `arduino.analogMax` | number | ADC range: `1023` (UNO R4 WiFi) or `4095` (ESP32). |

See also: [Pins and reading](pins.html) · [Extensions overview](extensions.html)
