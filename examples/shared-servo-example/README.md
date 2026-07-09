# Shared Servo — created by the sketch

A servo the **Arduino sketch creates** and the browser receives automatically. One line on the board:

```cpp
pan = PardaloteServo.attach("pan", 9);
```

and `arduino.pan` exists in every connected browser — a full `Servo` instance, identical to one created with `arduino.add('pan', new Servo())`. No JS-side setup.

## What this example demonstrates

- **The sketch creates the servo** — `PardaloteServo.attach("pan", pin)` attaches it on the board and announces it to browsers in the same act. Browsers that connect later get it too.
- **The browser object is the real thing** — `arduino.pan.write()`, `writeTimed()`, `whenDone()`, groups, limits: everything a browser-created servo has.
- **Both sides drive it, both stay in sync** — the sketch nods the servo every 4 s (`PardaloteServo.writeTimed(pan, …)`), the browser grabs it with the mouse. Sketch writes are auto-echoed, so `arduino.pan.angle` always tracks whoever wrote last.

This is the actuator counterpart of `Pardalote.share(pin, mode)` — except a servo has no life outside Pardalote, so there's no separate "share" step: creating it *is* sharing it. A servo that should stay private to the sketch shouldn't go through Pardalote at all — use the plain `Servo`/`ESP32Servo` library, the way unshared pins just use `pinMode()`.

## Hardware

- Arduino UNO R4 WiFi or ESP32 development board
- Hobby servo: signal on **pin 9**, plus 5 V and GND (power a real servo from a supply, not the board's 5 V pin)

## Run it

1. Open `shared-servo.ino` in Arduino IDE, select your board, upload.
2. Find the Arduino's IP from the LED matrix (UNO R4) or Serial Monitor (ESP32).
3. Edit `ArduinoIP` in `sketch.js` to match.
4. Open `index.html` in a browser.
5. Watch the sketch move the servo; press the mouse to take over.

## What's happening under the hood

On attach, the board broadcasts a `SHARE` frame (`[logicalId]` + the name) followed by the servo's attach state and angle. The JS core intercepts `SHARE`, constructs a `Servo`, and binds it as `arduino.pan`; the state frames then sync it through the normal announce machinery. The same sequence replays for every browser that connects later, so the object is always there before `'ready'` fires.

```javascript
arduino.on('share', ({ name, extension }) => { ... });  // optional: the moment it appears
arduino.on('ready', () => { arduino.pan.write(90); });  // it's simply there
```
