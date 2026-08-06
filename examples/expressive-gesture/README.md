# Expressive gesture

Authored, animation-style motion on a two-servo **pan/tilt head**. Each button
plays a **gesture** — an ordered list of eased moves the Arduino runs on its own
clock — and the page shows you the **exact code** that produced it. A nod, a
head-shake, a curious cock, a startle: personality built from easing curves, not
from mechanically-optimal positioning.

This is the p5.js demonstration of `gesture()` and
`group.gesture()` (see the [groups reference](../../README.md#groups)). The two
servos form a group, and a gesture gives each one its own **lane** of segments:

```javascript
head.gesture({
    pan:  [{ by: 22, dur: 300, curve: 'easeOut'   }],
    tilt: [{ by:-14, dur: 220, curve: 'back'      },   // a quizzical over-cock
           { by:  4, dur: 300, curve: 'easeInOut' }],
});
```

Segments are **relative** (`by` deltas), so the board captures each servo's angle
as it goes — no homing, no absolute position truth. Lanes of different length are
**padded** so both servos still arrive together. `curve: 'back'` overshoots the
target and settles, which is what gives the motion its snap and follow-through.

## Hardware

Any Pardalote board (UNO R4 WiFi or ESP32) plus **two hobby servos** on
PWM-capable pins — the defaults are **9** (pan) and **10** (tilt), editable under
the display. Mount them as a pan/tilt bracket if you have one, or just watch the
two horns; the gestures read clearly either way. Give the servos their own **5 V**
supply with a common ground.

The Arduino sketch only needs the servo extension:

```cpp
#include <Pardalote.h>
#include <PardaloteServo.h>

void setup() { Pardalote.begin(); }
void loop()  { Pardalote.run();   }
```

## Browser

1. Open `index.html` in a browser.
2. Type the board's IP into the field at the top and press **Connect**.
3. Press any gesture button — the head plays it and the code appears below.

The head preview is driven by the library's own `curveShape()` easing, so it
matches what the board plays — and it works **without a connection**, so you can
design and read the motion before any hardware is wired.

| Control | Action |
|---|---|
| Gesture buttons | play that gesture; its code shows below the display |
| Center | glide both servos back to 90° (`group.writeTimed`) |
| pan pin / tilt pin | the two PWM pins (rebuilds on change) |

## Notes

- **Where to author.** The gestures live in the `GESTURES` object at the top of
  `sketch.js`, as plain data — the same definition drives the servos, the code
  panel, and the preview. Edit a `by` / `dur` / `curve` and the change shows up
  in all three. Curves are `linear`, `easeIn`, `easeOut`, `easeInOut`, `back`.
- **Relative, so it's portable.** Because every segment is a `by` delta, a
  gesture plays the same from wherever the head currently sits. *Look away* ends
  off-centre on purpose — press **Center** to return.
- **Arrive together.** *Curious* and *Startle* move both servos with lanes of
  different total length; the shorter lane is padded with a hold so the two
  finish on the same tick. See the note on `group.gesture()` in the
  [Groups docs](../../README.md#groups).
- **On the board, not the wire.** The whole schedule is sent once and played by
  the Arduino — pull the network mid-gesture and it still finishes. Nothing is
  streamed step by step.
