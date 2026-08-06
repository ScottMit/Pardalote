title: Messaging
lede: A key/value channel for everything that isn't a pin or a device — symmetric between the browser and the sketch, plus a frame monitor that sees all traffic.
---
`share`/`send` and the extensions all move *hardware* state. **Messaging** is the channel for everything else: named key/value messages that aren't tied to any pin or device. One side sends a value under a string key; the other side watches keys and reads values. It's symmetric — the same idea works both ways — and it carries every basic type: `int`, `bool`, `float`, `char`, text, and binary blobs.

Because the key is a **string**, `send` never collides with the pin `digitalWrite`/`analogWrite` calls — pins stay on their own verbs.

Each direction below shows both halves: the **send** call on one side and the **receive** call on the other. Watch the badge on each code block for the language.

## JavaScript to Arduino

Send from the browser with `arduino.send(key, value)`; receive it in the sketch with `watch()` (one key) or `onMessage()` (every key).

<div class="sig">arduino.<span class="fn">send</span>(key, value, [options])</div>

The value's type is inferred from the JavaScript value; `options` is an optional `{ retain, broadcast }` (see below).

```javascript Send — in the browser
arduino.send('mode', 'idle');    // text
arduino.send('temp', 22.5);      // float  (inferred from the value)
arduino.send('count', 42);       // int
arduino.send('enabled', true);   // bool
arduino.send('frame', pixels);   // Uint8Array → blob
```

On the sketch side, callbacks receive a `Message`; `m.type` says which accessor is valid (`asInt` / `asBool` / `asFloat` / `asChar`, or `text` / `blob` with `length`).

```cpp Receive — in the sketch
void setup() {
    Pardalote.begin();
    Pardalote.watch("mode", onMode);   // handle one key
    Pardalote.onMessage(onAny);        // handle every key
}

void onMode(const Message& m) {
    // m.type is MSG_TYPE_TEXT here
    setState(m.text);
}

void onAny(const Message& m) {
    // m.asInt() / m.asBool() / m.asFloat() / m.asChar() / m.text / m.blob (m.length)
}
```

## Arduino to JavaScript

Send from the sketch with `Pardalote.send(key, value)`; receive it in the browser with `watch()` or `on('message')`. `arduino.messages` also caches the last value seen for every key.

<div class="sig">Pardalote.<span class="fn">send</span>(key, value, [flags]) · Pardalote.<span class="fn">sendBlob</span>(key, data, len, [flags])</div>

Typed overloads accept `int`, `double`, `bool`, `char`, and `const char*`; `sendBlob` sends raw bytes. `flags` is `MSG_FLAG_RETAIN`, `MSG_FLAG_BROADCAST`, or the two OR'd together.

```cpp Send — in the sketch
Pardalote.send("temp", 22.5);                  // double
Pardalote.send("count", 42);                   // int
Pardalote.send("mode", "idle", MSG_FLAG_RETAIN);
```

In the browser, `watch(key, fn)` fires for one key, `on('message', …)` catches them all, and `unwatch(key, [fn])` removes a watcher.

```javascript Receive — in the browser
// Watch one key — the callback fires whenever a message with that key arrives
arduino.watch('temp', (value, key, type) => console.log(key, '=', value));

// Or catch every message
arduino.on('message', ({ key, value, type }) => { /* type: 'int','float',… */ });

// Last received value for any key
let mode = arduino.messages['mode'];
```

A sketch `send` reaches every browser. The board's outgoing frame buffer caps a single Arduino→browser text/blob at about 240 bytes; browser→Arduino is not limited that way.

## Retain and broadcast

Two optional flags shape delivery — set them on the sender (`{ retain, broadcast }` from JavaScript, `MSG_FLAG_*` from the sketch):

```javascript Sending with flags — in the browser
arduino.send('mode', 'idle', { retain: true });    // stored on the board,
                                                    // replayed to browsers that connect later
arduino.send('cursor', 120, { broadcast: true });   // relayed to the OTHER browsers too
arduino.send('mode', 'run', { retain: true, broadcast: true });
```

- **`retain`** — the board keeps the latest value for that key and re-sends it to any client that connects, in the same sync step as pin and extension state. New clients immediately see the current value; without it, a message is a one-off event. (Scalars are always retained; a retained text/blob must be ≤ 48 bytes, else the board warns and skips it.)
- **`broadcast`** — the board relays a browser's message to the *other* connected browsers (it's the hub), so multiple browsers can coordinate. Without it, a browser message goes only to the Arduino sketch. A sketch `send` always reaches every browser.

## Inspecting all traffic

The **frame monitor** is a superset of message-watching — it sees **every** frame in and out, decoded and named, so it doubles as a live protocol inspector. It costs nothing until a handler is registered.

<div class="sig">arduino.<span class="fn">on</span>('frame', handler) · arduino.<span class="fn">monitor</span>(handler)</div>

```javascript Watch all traffic — in the browser
arduino.on('frame', ({ dir, cmdName, target, params, payload }) => {
    console.log(dir, cmdName, params);   // 'in' 'SERVO_WRITE' [0, 90], 'out' 'MESSAGE', …
});
arduino.monitor(fn);        // shorthand for on('frame', fn)
arduino.off('frame', fn);   // stop
```

The handler gets `{ dir, cmd, cmdName, target, params, payload }` — `dir` is `'in'` or `'out'`, `cmdName` is the decoded name (hex fallback for unknown commands). On the sketch side:

```cpp Watch all traffic — in the sketch
Pardalote.onFrame([](const FrameEvent& ev) {
    Serial.println(ev.name);            // "MESSAGE", "DIGITAL_WRITE", …
});
```

See **File → Examples → Pardalote → messaging** and `examples/messaging/` for a browser example with a live traffic inspector.

See also: [The Arduino sketch](arduino.html) · [Connecting](connecting.html) · [Protocol](protocol.html)
