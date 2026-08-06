title: Rotary encoder
lede: Quadrature encoders — KY-040 knobs and motor shaft encoders, counted in interrupts on the board.
---
Quadrature encoders can't be read by polling: direction lives in the *order* the two pins change, and a hand-flicked knob produces ~1,600 edges a second. The board counts them in interrupt handlers with a 4x state-table decoder — invalid transitions (contact bounce) sum to zero, so the count never drifts and no debounce tuning is needed. The browser receives the **absolute position**, rate-limited per browser.

Positions are **raw quadrature steps** — a KY-040 detent is 4 steps. Use `setStepsPerDetent()` to scale the `detents` convenience.

## attach()

<div class="sig">arduino.knob.<span class="fn">attach</span>(pinA, pinB)</div>

| Parameter | Type | Description |
|---|---|---|
| `pinA`, `pinB` | number \| string | The two quadrature signal pins (CLK/DT on a KY-040). The board enables pullups and attaches CHANGE interrupts on both. |

```javascript
arduino.add('knob', new Encoder());
arduino.on('ready', () => {
    arduino.knob.attach(D2, D3);
    arduino.knob.read(50);          // stream, at most every 50 ms
});
```

**The push button** on a KY-040 is not part of this extension — it's just a switch. Wire it to any pin and use a [pin handle](pins.html#pin--the-listening-handle), which delivers debounced edges instantly:

```javascript
arduino.pin(SW).on('change', ({ value }) => { if (!value) togglePlayback(); });
```

## read()

Streams the position. The board counts continuously either way (interrupts); `interval` is purely a per-browser rate limit, and because position is absolute the latest value always carries the full state — a fast spin can't overflow the channel or lose track.

<div class="sig">arduino.knob.<span class="fn">read</span>([interval], [threshold])</div>

| Parameter | Type | Description |
|---|---|---|
| `interval` | number | Optional. Minimum ms between updates to this browser (default `200`). Pass `END` to stop. |
| `threshold` | number | Optional. Minimum change worth transmitting, in steps (`0` = default `1`; use `4` for one KY-040 detent per update). Also settable via `setReadInterval(ms)` / `setReadThreshold(steps)`. |

**Returns** the cached position (raw steps).

## setPosition() / zero()

Re-declares the current physical position. The board sets its counter and echoes the new position to **every** browser, so all mirrors adopt the new frame together.

<div class="sig">arduino.knob.<span class="fn">setPosition</span>(value) · arduino.knob.<span class="fn">zero</span>()</div>

## Events

<div class="sig">arduino.knob.<span class="fn">on</span>(event, handler)</div>

| Event | Payload | Fires when |
|---|---|---|
| `'change'` | `{ position, delta, detents }` | The position changed by at least the threshold. `delta` is the movement since the last event this browser saw (sign = direction). |

Shorthand: `onChange(fn)`.

```javascript Example — a volume knob
arduino.knob.on('change', ({ delta }) => {
    volume = constrain(volume + delta, 0, 100);
});
```

## Properties and state

| Property | Description |
|---|---|
| `arduino.knob.position` | Current position in raw steps (draw()-loop safe). |
| `arduino.knob.detents` | Position scaled by `stepsPerDetent` (default 4). |

<div class="sig">arduino.knob.<span class="fn">setStepsPerDetent</span>(n) · arduino.knob.<span class="fn">getState</span>()</div>

## From the sketch

Create an encoder in the sketch and every browser sees it as `arduino.<name>` automatically — same pattern as the other extensions:

```cpp
#include <Pardalote.h>
#include <PardaloteEncoder.h>

int knob;
void setup() {
    Pardalote.begin();
    knob = PardaloteEncoder.attach("knob", 2, 3);   // name, pinA, pinB
}

void loop() {
    Pardalote.run();
    long pos = PardaloteEncoder.read(knob);          // raw steps, from the ISR counter
    // PardaloteEncoder.zero(knob);                  // re-zero (echoed to browsers)
}
```

Up to 4 encoders (`MAX_ENCODERS`). Motor shaft encoders up to ~10–20 kHz edge rates are fine; beyond that (high-resolution encoders on fast spindles), a hardware pulse-counter backend would be the next step — ask if you need it.

See also: [Pins and reading](pins.html) · [Extensions overview](extensions.html)
