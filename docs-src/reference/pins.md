title: Pins and reading
lede: The core pin API — modes, writes, polled reads, change callbacks, and pin aliases.
---
Anywhere a `pin` is accepted you can pass a number (`13`), a board constant (`A0`, `LED_BUILTIN` — see [Pin aliases](#pin-aliases)), or a string alias (`'A0'`).

## pinMode()

Sets a pin's mode. For input modes, an optional interval starts periodic reads immediately.

<div class="sig">arduino.<span class="fn">pinMode</span>(pin, mode, [interval])</div>

| Parameter | Type | Description |
|---|---|---|
| `pin` | number \| string | The pin to configure. |
| `mode` | constant | `OUTPUT`, `INPUT`, `INPUT_PULLUP`, `INPUT_PULLDOWN`, or `ANALOG_INPUT`. |
| `interval` | number | Optional. Poll interval in ms — starts periodic reads straight away (input modes only). |

```javascript
arduino.pinMode(13, OUTPUT);
arduino.pinMode(7,  INPUT_PULLUP);
arduino.pinMode(A0, ANALOG_INPUT, 50);  // and start reading A0 every 50 ms
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

## analogRead()

Reads the value of an analog pin. The first call starts a periodic poll on the Arduino; every later call returns the cached value instantly — so it's safe to call on every frame of a draw loop with no extra network traffic.

<div class="sig">arduino.<span class="fn">analogRead</span>(pin, [interval])</div>

| Parameter | Type | Description |
|---|---|---|
| `pin` | number \| string | The analog pin to read, e.g. `A0`. |
| `interval` | number | Optional. Poll interval in ms (default `200`). Pass `END` to stop polling. Calling with the interval already in effect just returns the cache. |

**Returns** the most recent value, `0` to `arduino.analogMax`. Returns `0` until the first reading arrives.

```javascript Example — circle that follows a knob
function draw() {
    let v = arduino.analogRead(A0, 50);   // poll every 50 ms
    let size = map(v, 0, arduino.analogMax, 10, width);
    circle(width / 2, height / 2, size);
}
```

## digitalRead()

Reads a digital pin. Same poll-and-cache pattern as `analogRead()`.

<div class="sig">arduino.<span class="fn">digitalRead</span>(pin, [interval])</div>

| Parameter | Type | Description |
|---|---|---|
| `pin` | number \| string | The digital pin to read. |
| `interval` | number | Optional. Poll interval in ms (default `200`). Pass `END` to stop polling. |

**Returns** `HIGH` (1) or `LOW` (0); `0` until the first reading arrives.

## onChange()

Registers a callback that fires whenever a polled pin's value changes.

<div class="sig">arduino.<span class="fn">onChange</span>(pin, handler)</div>

| Parameter | Type | Description |
|---|---|---|
| `pin` | number \| string | The pin to watch. Polling must be running (via `pinMode` interval, a read call, or the Arduino's `share()`). |
| `handler` | function | Receives `(value, pin)`. |

```javascript Example — react to changes
arduino.onChange(A0, (value, pin) => console.log('A0 →', value));
```

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

Rather than raw numbers, include the pin file for your board and use named constants. This prevents mistakes and makes sketches portable.

```html
<!-- in index.html, after pardalote.js -->
<script src="pardalote-pins-esp32-wrover-dev.js"></script>
```

```javascript
arduino.pinMode(A0, ANALOG_INPUT, 50);
arduino.digitalWrite(LED_BUILTIN, HIGH);
arduino.imu.attach(SDA);
```

| File | Board |
|---|---|
| `pardalote-pins-uno-r4-wifi.js` | Arduino UNO R4 WiFi |
| `pardalote-pins-esp32-wrover-dev.js` | ESP32-WROVER-DEV |
| `pardalote-pins-firebeetle2-esp32-c5.js` | FireBeetle 2 ESP32-C5 |

String aliases also work anywhere a pin is accepted:

```javascript
arduino.analogRead('A0');      // resolved from the board's alias table
arduino.digitalWrite('SDA', HIGH);
```

See also: [Connecting](connecting.html) · [The Arduino sketch](arduino.html)
