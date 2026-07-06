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

## State sync on connect

On connect, the Arduino sends its full current state — pin modes, output values, extension configuration, NeoPixel colours — before signalling `ready`. Any browser connecting to a running system immediately sees live state. This is why Pardalote is multi-user by default: every client starts from the same picture.

## Building your own extension

Extensions live at both ends: a JS file that encodes frames for your commands, and an Arduino header that registers a handler for them. The built-in extensions are working references — `ultrasonic` is the smallest, `busServo` the most complete. See [Extensions overview](extensions.html).
