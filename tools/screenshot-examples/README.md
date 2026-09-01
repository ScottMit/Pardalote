# Example screenshotter

Generates the "working" screenshots shown on the example doc pages
(`docs/examples/*.html`) — **without any hardware**. Output lands in
`docs/assets/examples/<name>.png`.

## How it works

Each example is a browser page that talks to a board over a WebSocket and only
renders its live UI after the library fires `ready`. This tool injects a **fake
`WebSocket`** into the page *before* its own scripts run (`evaluateOnNewDocument`).
That fake socket is a **virtual Pardalote board**: it speaks the real binary
protocol back —

- **HELLO** (`0x00`) with the board string, ADC bits and a boot id, then
  **SYNC_COMPLETE** (`0x0A`) → the real `pardalote.js` finishes its handshake
  and fires `ready`, exactly as against hardware;
- answers **PING** (`0x08`) with **PONG** (`0x09`) so the heartbeat stays up;
- feeds per-example data: core `analogRead`/`digitalRead` responses, extension
  READ frames (ultrasonic `0x20`, IMU `0x2A` floats, stepper `0x3E`, bus-servo
  `0x48`), board-`share()`d devices (`CMD_SHARE 0x56` + announce frames) and
  pins, and `CMD_MESSAGE` (`0x0B`) traffic.

The tool serves the repo over a throwaway `localhost` HTTP server (loading the
pages over `file://` renders them as static snapshots that don't run JS),
drives the connection UI (fills the IP field, clicks Connect — firing both
`mousedown` for p5 buttons and `click` for DOM buttons), waits, and captures
the visual element (`canvas`, `#stage`, or `main`) with real rendered pixels
(so the WebGL IMU view captures correctly).

## Use

```bash
cd tools/screenshot-examples
npm install          # once — installs puppeteer-core (drives your own Chrome)

# Validate / eyeball renders — writes to ./out (scratch, gitignored):
node run.js                       # all examples → ./out
node run.js servo-control         # just one → ./out

# Produce the real doc screenshots (docs/assets/examples/):
node run.js --publish                          # only the ones still missing
node run.js --publish --force servo-control    # regenerate one, overwriting

node run.js --out /tmp/shots      # any custom directory
```

**Where images go:** by default a local **`./out`** scratch folder — that's for
checking a render, and nothing ships from there. Only `--publish` writes to
`docs/assets/examples/`, and `--out <dir>` targets anywhere else. So validating
a render never touches the docs.

**Run this ON REQUEST only — it is not part of any build.** The docs build
(`docs-src/build_examples.py`) never captures screenshots; it only wires PNGs
that already exist into the pages. **Non-destructive by default:** an existing
image in the output folder is skipped, never overwritten — the published
captures get hand-cropped after generation, and re-running would wipe that. Use
`--force` (or delete the PNG) to deliberately regenerate.

By default it captures the **whole page** (crop it yourself). To grab just the
configured visual element (canvas / `#stage` / `main`) instead:

```bash
SHOT=element node run.js
```

Prereqs: **Node 18+** and **Google Chrome** installed. If Chrome isn't in the
default location, set `CHROME_PATH=/path/to/chrome`. `puppeteer-core` does not
download a browser — it drives the one you already have.

After regenerating, the images are already referenced by the doc pages
(`<img class="screenshot" …>`); no HTML change needed unless you add a new
example.

## Adding / tuning an example

Add an entry to `EXAMPLES` in `run.js`:

```js
'my-example': {
  ...ESP,                       // or ...UNO  (board string + adcBits)
  connect: 'std',               // standard connect-row driving
  target: 'canvas',             // element to screenshot: 'canvas' | '#stage' | 'main'
  settle: 1600,                 // ms to wait before the shot (let animation run)
  feeds:  [{ kind: 'analog', pin: 14, ms: 120 }],   // periodic sensor frames
  // sharePins / shares / postFrames / messages — see existing entries
},
```

Feed `kind`s live in the `FEEDS` map: `analog`, `ultrasonic`, `imu`, `stepper`,
`busRead`. Add a new one there if a new extension needs live data. Device IDs:
NEO 200, SERVO 201, ULTRASONIC 202, IMU 203, CAMERA 204, STEPPER 205,
BUSSERVO 206, ENCODER 207.

## Not covered

`camera-stream` and `camera-posenet` are **not** simulated: the video is MJPEG
served over HTTP from the board's own IP, and PoseNet needs a real subject in
frame — faking either would mean fabricating camera imagery. Capture those two
from real hardware.
