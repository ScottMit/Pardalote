title: Pins and reading
lede: The core pin API — modes, writes, polled reads, change callbacks, and pin aliases.
---
Anywhere a `pin` is accepted you can pass a number (`13`), a board constant (`A0`, `LED_BUILTIN` — see [Pin aliases](#pin-aliases)), or a string alias (`'A0'`).

## pinMode()

Sets a pin's mode. For input modes, an optional interval starts periodic reads immediately.

<div class="sig">arduino.<span class="fn">pinMode</span>(pin, mode, [interval], [threshold])</div>

| Parameter | Type | Description |
|---|---|---|
| `pin` | number \| string | The pin to configure. |
| `mode` | constant | `OUTPUT`, `INPUT`, `INPUT_PULLUP`, `INPUT_PULLDOWN`, or `ANALOG_INPUT_MODE`. |
| `interval` | number | Optional. Starts watching the pin straight away (input modes only); acts as the analog rate limit. |
| `threshold` | number | Optional. Change threshold — see [Thresholds](#thresholds). |

```javascript
arduino.pinMode(13, OUTPUT);
arduino.pinMode(7,  INPUT_PULLUP);
arduino.pinMode(A0, ANALOG_INPUT_MODE, 50);     // watch A0, update at most every 50 ms
arduino.pinMode(A0, ANALOG_INPUT_MODE, 50, 8);  // …transmitting changes of 8+ counts
```

## digitalWrite()

Sets a digital output pin high or low.

<div class="sig">arduino.<span class="fn">digitalWrite</span>(pin, value)</div>

| Parameter | Type | Description |
|---|---|---|
| `pin` | number \| string | The pin to write. |
| `value` | constant | `HIGH` or `LOW`. |

## analogWrite()

Writes a PWM value to a pin.

<div class="sig">arduino.<span class="fn">analogWrite</span>(pin, value)</div>

| Parameter | Type | Description |
|---|---|---|
| `pin` | number \| string | The pin to write. |
| `value` | number | Duty cycle, `0`–`255`. |

Writes are **rate-limited per pin** so you can safely drive `analogWrite()` from a slider or a draw loop: the first write goes out immediately, and rapid follow-ups are coalesced into a single send that carries the latest value — the resting value is never lost. The default window is 20 ms (~50 writes/s per pin), which is imperceptible on ESP32 and keeps the slower UNO R4 WiFi from being flooded off the socket. Tune it with `setWriteThrottle()` / `setWriteThreshold()`, or pass `0` to `setWriteThrottle()` to send every value.

## setWriteThrottle() / setWriteThreshold()

Rate-limits outgoing PWM writes — the outbound counterpart to `setReadInterval()`. Useful when `analogWrite()` is driven from mouse movement or a draw loop, and essential for keeping the UNO R4 WiFi responsive under a fast slider.

<div class="sig">arduino.<span class="fn">setWriteThrottle</span>(ms) · arduino.<span class="fn">setWriteThreshold</span>(value)</div>

| Parameter | Type | Description |
|---|---|---|
| `ms` | number | Minimum ms between PWM sends on a pin. Default `20`. `0` = off (send every value). |
| `value` | number | Minimum duty change worth sending. Default `0` (send all). |

Both apply to every `analogWrite()` pin and are chainable.

## analogRead()

Reads the value of an analog pin. The first call starts a periodic poll on the Arduino; every later call returns the cached value instantly — so it's safe to call on every frame of a draw loop with no extra network traffic.

<div class="sig">arduino.<span class="fn">analogRead</span>(pin, [interval], [threshold])</div>

| Parameter | Type | Description |
|---|---|---|
| `pin` | number \| string | The analog pin to read, e.g. `A0`. |
| `interval` | number | Optional. Minimum ms between updates to this browser (default `200`) — a rate limit, not a sampling clock; see [How watching works](#how-watching-works--intervals-and-thresholds). Pass `END` to stop. Calling with the settings already in effect just returns the cache. |
| `threshold` | number | Optional. Change threshold — see [How watching works](#how-watching-works--intervals-and-thresholds). |

**Returns** the most recent value, `0` to `arduino.analogMax`. Returns `0` until the first reading arrives.

```javascript Example — circle that follows a knob
function draw() {
    let v = arduino.analogRead(A0, 50);   // updates at most every 50 ms
    let size = map(v, 0, arduino.analogMax, 10, width);
    circle(width / 2, height / 2, size);
}
```

## digitalRead()

Reads a digital pin. Same poll-and-cache pattern as `analogRead()`.

<div class="sig">arduino.<span class="fn">digitalRead</span>(pin, [interval], [threshold])</div>

| Parameter | Type | Description |
|---|---|---|
| `pin` | number \| string | The digital pin to read. |
| `interval` | number | Optional. Registers the watch (default `200`). Digital changes are transmitted immediately regardless of the interval — edges are never delayed. Pass `END` to stop. |
| `threshold` | number | Optional. Change threshold (digital default `1` — any change). |

**Returns** `HIGH` (1) or `LOW` (0); `0` until the first reading arrives.

## How watching works — intervals and thresholds

The board watches pins continuously and transmits **meaningful changes**; the `interval` is a per-browser **rate limit** (minimum ms between updates), not a sampling clock:

- **Digital pins** are checked on every pass of the board's loop. A level change is transmitted **immediately** — a button press never waits for a timer, and even a very short tap delivers both edges (a 15 ms lockout absorbs contact bounce). Idle pins transmit nothing.
- **Analog pins** are sampled every 10 ms internally. A change on a dormant pin goes out at once; a continuously moving pin updates each browser at most once per its `interval`.

The Arduino only transmits a reading when it has changed by at least `threshold` since the value this browser last saw. That keeps the channel quiet while a sensor sits still: a raw ADC jitters by a count or two constantly, so without a threshold "send on change" sends nearly every sample.

Defaults (used when the threshold is `0` or omitted):

| Kind | Default threshold |
|---|---|
| Digital | `1` — any change |
| Analog | the ADC noise floor: `analogMax >> 8`, min `1` (UNO ≈ 4 counts, ESP32 ≈ 16) |

Thresholds and intervals are **per browser**: each connected page gets its own rate limit and its own idea of a meaningful change, without disturbing anyone else's. The pin itself is watched once, on the board.

Reading a precise sensor? Set the threshold to `1` to receive every count of change.

## setReadInterval() / setReadThreshold()

Set a pin's poll interval or change threshold directly — before polling starts (stored and applied when the read registers) or while it runs (applied immediately).

<div class="sig">arduino.<span class="fn">setReadInterval</span>(pin, ms) · arduino.<span class="fn">setReadThreshold</span>(pin, threshold)</div>

```javascript
arduino.setReadThreshold(A0, 1);     // precision mode: every count matters
arduino.setReadInterval(A0, 25);     // …and poll fast
let v = arduino.analogRead(A0);      // uses the stored settings
```

The global defaults are also settable: `arduino.defaultInterval` (ms, `200`) and `arduino.defaultThreshold` (`0` = board default).

## pin() — the listening handle

The verbs above are how you **do** things. To **listen** to a pin, take its handle — it speaks the same grammar as every device (`arduino.pan`, `arduino.sonar`, …):

<div class="sig">arduino.<span class="fn">pin</span>(ref)</div>

| Parameter | Type | Description |
|---|---|---|
| `ref` | number \| string | Pin number or alias (`'A0'`). Handles are cached — `pin(9)` twice returns the same object. |

```javascript Example — react to changes
const knob = arduino.pin('A0');
knob.on('change', ({ value, pin }) => console.log('A0 →', value));
knob.off('change', fn);                 // unsubscribe one handler (omit fn: all)
knob.setReadInterval(25);               // per-pin poll config
knob.setReadThreshold(4);
knob.value;                             // the mirrored value
```

`'change'` fires for **any** pin-state change: input readings that moved by at least the threshold, and output writes from any browser or the sketch — you don't need to care which kind of pin it is. For inputs, registering a listener auto-starts a default poll if none is running.

Alias handles resolve **lazily**: `arduino.pin('A0')` works before `'ready'`, even though the board's alias table hasn't arrived yet — the listener starts firing once it has. (The verbs still need resolvable pins at call time.)

Listeners survive `connect()` to a new board, like device extensions; polls are re-established automatically on the new board's sync.

The handle also carries conveniences — `knob.read()`, `knob.write(HIGH)`, `knob.mode(OUTPUT)` — but the Arduino-mirroring verbs remain the documented way to do things.

## end() / endAll()

Stops polling one pin, or all pins.

<div class="sig">arduino.<span class="fn">end</span>(pin) · arduino.<span class="fn">endAll</span>()</div>

```javascript
arduino.end(A0);    // stop one pin
arduino.endAll();   // stop all pins
```

## analogMax

The board's ADC range, set automatically from the HELLO handshake. Use it to map correctly on any board.

| Board | `arduino.analogMax` |
|---|---|
| UNO R4 WiFi | 1023 |
| ESP32 | 4095 |

```javascript Example — map correctly on any board
let mapped = map(arduino.analogRead(A0), 0, arduino.analogMax, 0, width);
```

## Pin aliases

Rather than raw numbers, use named pins — `D13`, `A0`, `SDA`, `LED_BUILTIN` — exactly as you would in Arduino code. They work out of the box; nothing extra to include.

```javascript
arduino.on('ready', () => {
    arduino.pinMode(A0, ANALOG_INPUT_MODE, 50);
    arduino.digitalWrite(LED_BUILTIN, HIGH);
    arduino.imu.attach(SDA);
});
```

Each name resolves to the correct physical pin **for the board this `arduino` is actually connected to**, looked up when the `ready` event fires. The *same* `D13` therefore maps to the right pin on each board — and two `Arduino()` instances driving different boards each resolve it correctly, which a fixed global number never could. Because resolution happens at `ready`, reference pins from inside an `arduino.on('ready', …)` handler (or later), not at the top level before the board is known.

If a name collides with your own code or another library, Pardalote quietly steps aside (it never overwrites a name you've already defined). To switch the named pins off entirely, add `data-pins="off"` to the script tag:

```html
<script src="pardalote.js" data-pins="off"></script>
```

The **string form** works anywhere a pin is accepted and needs no global at all — handy with `data-pins="off"`, or for a name your board doesn't predefine:

```javascript
arduino.analogRead('A0');      // resolved from the board's alias table
arduino.digitalWrite('SDA', HIGH);
```

See also: [Connecting](connecting.html) · [The Arduino sketch](arduino.html)
