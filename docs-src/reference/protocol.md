title: Protocol
lede: The compact binary WebSocket protocol underneath everything — for the curious, and for anyone building their own extension.
---
## Frame format

Pardalote uses a compact binary WebSocket protocol. Each frame is:

```
Byte 0      CMD          — command code
Bytes 1–2   TARGET       — pin number or extension device ID
Byte 3      NPARAMS      — number of parameters
Bytes 4–5   TYPE_MASK    — bit per param: 0 = int32, 1 = float32
Bytes 6–7   PAYLOAD_LEN  — length of optional trailing string/blob
Bytes 8+    PARAMS       — NPARAMS × 4 bytes
Bytes 8+N×4 PAYLOAD      — optional string or binary data
```

## Batching

Multiple frames are batched into a single WebSocket message before sending. The `FrameBuilder` class (Arduino) and `encodeFrame()` / `encodeBatch()` functions (JS) handle this automatically. Batching is what makes [group](groups.html) writes land together on the board.

## Gesture frames

Expressive motion is pushed as a **segment schedule** the board plays on its own clock — never streamed step-by-step. One frame per actuator type (`CMD_SERVO_GESTURE` `0x58`, `CMD_STEPPER_GESTURE` `0x59`, `CMD_BUSSERVO_GESTURE` `0x5A`) carries one or more channel blocks in its payload:

```
Per channel:  [ logicalId u8 ][ flags u8 ][ count u8 ]  then count × segment
Per segment:  [ curve u8 ][ dur u16, ms ][ value i32 ]        (big-endian)
```

`flags` bit 0 selects the reference frame (relative delta vs absolute target); `value` is a signed displacement or target in the actuator's native unit (degrees, steps, counts); `curve` indexes the shared easing table (`linear`, `easeIn`, `easeOut`, `easeInOut`, `back`). A [group gesture](groups.html#gesture) batches every type's frame into one message. This same record layout is what an on-device sequencer replays — one gesture vocabulary shared across the browser and the board — so a [sketch can author gestures](extensions.html#board-authored-gestures) with the identical frames.

While a schedule plays, the board emits a lightweight `CMD_*_GESTURE_STATE` (`0x64`/`0x65`/`0x66`, `[id, active]`) on the start and end of the motion — **existence, never the schedule** — so every browser can reflect an `isGesturing` state (and a reconnecting one learns it in the state sync below). It fires whoever authored the gesture, browser or sketch. Added in protocol **v1.1** (backward-compatible: older clients ignore the unknown code).

## State sync on connect

On connect, the Arduino sends its full current state — pin modes, output values, current readings of every polled input, extension configuration, NeoPixel colours — before signalling `ready`. Any browser connecting to a running system immediately sees live state. This is why Pardalote is multi-user by default: every client starts from the same picture.

## Periodic reads

A read registration (`CMD_DIGITAL_READ` / `CMD_ANALOG_READ`, params `[interval, threshold]`) is **per client**: the board keeps a separate interval, change threshold, and last-sent value for each connected browser, and only transmits a reading to a browser when it has changed by at least that browser's threshold since the value that browser last saw. Looking is decoupled from telling: digital pins are watched on every loop pass and edges transmit immediately (15 ms bounce lockout; the interval never delays them); analog pins are sampled every 10 ms, with each client's interval acting as a minimum spacing between its updates. A threshold of `0` selects the board default (`1` for digital; the analog noise floor, `analogMax >> 8`, min `1`). `CMD_END` removes only the sending client's registration, and a client's registrations are dropped when it disconnects. Board-owned polls (`share()` with an interval) are announced in `CMD_PIN_MODE` as `[mode, interval, threshold]` and survive disconnects. Older clients and older firmware simply omit or ignore the extra params.

## Building your own extension

Extensions live at both ends: a JS file that encodes frames for your commands, and an Arduino header that registers a handler for them. The built-in extensions are working references — `ultrasonic` is the smallest, `busServo` the most complete. See [Extensions overview](extensions.html).
