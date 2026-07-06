title: NeoPixel
lede: Up to 4 addressable LED strips — buffered pixel changes, brightness control, and throttled updates for smooth animation.
---
Requires the `Adafruit NeoPixel` library and `<PardaloteNeoPixel.h>` in the sketch. Examples assume:

```javascript
arduino.add('strip', new NeoPixel());
```

## init()

Initialises the strip. Call inside `on('ready')`.

<div class="sig">arduino.strip.<span class="fn">init</span>(pin, numPixels, [type])</div>

| Parameter | Type | Description |
|---|---|---|
| `pin` | number \| string | Data pin the strip is wired to. |
| `numPixels` | number | Number of LEDs on the strip. |
| `type` | constant | Optional. Colour order + speed, e.g. `NEO_GRB + NEO_KHZ800` (the default, right for most WS2812B strips). |

```javascript Example — init two strips
arduino.strip.init(6, 30);                     // pin 6, 30 pixels
arduino.strip.init(7, 16, NEO_GRB + NEO_KHZ800);
```

## setPixelColor()

Sets one pixel in the local buffer. Nothing reaches the LEDs until `show()`.

<div class="sig">arduino.strip.<span class="fn">setPixelColor</span>(index, r, g, b, [w])</div>

| Parameter | Type | Description |
|---|---|---|
| `index` | number | Pixel index, `0`-based. |
| `r`, `g`, `b` | number | Colour components, `0`–`255`. |
| `w` | number | Optional white channel (RGBW strips). |

Also accepts a packed colour: `setPixelColor(index, color)`.

## Color()

Packs r, g, b into a single 32-bit colour value.

<div class="sig">arduino.strip.<span class="fn">Color</span>(r, g, b)</div>

```javascript Example — pack a colour
let red = arduino.strip.Color(255, 0, 0);
arduino.strip.setPixelColor(0, red);
```

## fill()

Fills the whole strip, or a range, with one colour (buffered).

<div class="sig">arduino.strip.<span class="fn">fill</span>(color, [first], [count])</div>

| Parameter | Type | Description |
|---|---|---|
| `color` | number | Packed colour from `Color()`. |
| `first` | number | Optional. First pixel to fill. |
| `count` | number | Optional. Number of pixels to fill. |

```javascript Example — fill a range
arduino.strip.fill(red);          // entire strip
arduino.strip.fill(red, 0, 10);   // pixels 0–9
```

## clear()

Sets all pixels to off (buffered).

<div class="sig">arduino.strip.<span class="fn">clear</span>()</div>

## setBrightness()

Global brightness scale.

<div class="sig">arduino.strip.<span class="fn">setBrightness</span>(level)</div>

| Parameter | Type | Description |
|---|---|---|
| `level` | number | `0`–`255`. Default `255` — strips vary, start lower. |

## show()

Sends the buffered changes to the LEDs. Debounced: rapid draw-loop calls coalesce into a single send (the latest pending state wins).

<div class="sig">arduino.strip.<span class="fn">show</span>()</div>

## getPixelColor() / numPixels()

Reading back the local buffer.

<div class="sig">arduino.strip.<span class="fn">getPixelColor</span>(index) · arduino.strip.<span class="fn">numPixels</span>()</div>

**Returns** a 32-bit packed colour / the pixel count.

## setThreshold()

Pixel changes below the colour distance threshold are ignored — useful for animation loops that might send identical values.

<div class="sig">arduino.strip.<span class="fn">setThreshold</span>(distance)</div>

| Parameter | Type | Description |
|---|---|---|
| `distance` | number | Minimum colour distance to count as a change. Default `5`. |

## setThrottle()

Minimum time between `show()` flushes. Default 20 ms (~50 Hz max). Raise it if you see queue-buildup lag on a slow link; set `0` to disable debouncing.

<div class="sig">arduino.strip.<span class="fn">setThrottle</span>(ms)</div>

```javascript Example — tune the flush rate
arduino.strip.setThrottle(50);  // gentler on the UNO R4's WiFi
arduino.strip.setThrottle(0);   // every show() flushes
```

## Type constants

```javascript
// Colour order
NEO_RGB   NEO_RBG   NEO_GRB   NEO_GBR   NEO_BRG   NEO_BGR

// Speed
NEO_KHZ800  // most strips (default)
NEO_KHZ400  // older strips

// Combine:
arduino.strip.init(6, 30, NEO_GRB + NEO_KHZ800);
```

<div class="sig">arduino.strip.<span class="fn">getState</span>()</div>

**Returns** a snapshot of all strip state.

See also: [NeoPixel example](../examples/neopixel-example.html) · [Troubleshooting](troubleshooting.html)
