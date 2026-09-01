# Camera PoseNet

Runs [ml5.js](https://ml5js.org/) **PoseNet** on the live MJPEG video from an
ESP32 camera — green dots track a person's joints and white lines connect them
into a skeleton, all in a p5.js canvas.

It's the [camera-stream](../camera-stream/) example with pose detection layered
on top: instead of pointing PoseNet at a webcam (`createCapture(VIDEO)`), it
points it at the board's video stream.

---

## What you need

- An ESP32 board with a camera module and PSRAM, flashed with the **camera-stream**
  firmware (see [camera-stream](../camera-stream/) — the same `<PardaloteCamera.h>`
  sketch drives this example; there's nothing new to upload)
- A web browser on the same WiFi network, with internet access the first time
  (ml5.js and its model are loaded from a CDN)

The stream is served over HTTP straight from the board's IP, so this example
needs a **WiFi** connection — USB carries only the control link, not video.

---

## Files

| File | Purpose |
|---|---|
| `index.html` | Loads p5.js, **ml5.js**, Pardalote, and the sketch |
| `sketch.js` | Connects, streams, runs PoseNet, draws keypoints + skeleton |
| `connect.js` | Board connection UI (WiFi / USB, remembered per browser) |
| `style.css` | Pardalote example house style |

---

## Browser setup

Open `index.html` from a local web server (browsers block some connections from
`file://` pages — `npx serve .` works). In the **Board** row enter the board's
IP and press **Connect** — the setting is remembered per browser. The model
loads on its own; once video arrives, keypoints appear over it.

Two settings live at the top of `sketch.js`:

```javascript
const FRAME_SIZE = FRAMESIZE_VGA;   // 640×480 — matches the canvas
const MIRROR     = false;           // flip left-to-right (a webcam selfie is mirrored)
```

An outward-facing ESP32 camera usually shouldn't be mirrored, so `MIRROR`
defaults to `false`; set it `true` for a selfie-style flip.

---

## How it works

The one real difference from a webcam is **where the pixels come from and how
PoseNet reads them**.

```javascript
// A raw <img>, loaded cross-origin so PoseNet may READ its pixels. crossOrigin
// MUST be set before src, or the pixel read throws a tainted-canvas error. This
// works because PardaloteCamera.h serves Access-Control-Allow-Origin: *.
imgEl = new Image();
imgEl.crossOrigin = 'anonymous';
imgEl.src = url;                    // the MJPEG stream URL, from cam.on('stream')
```

The stream isn't a `<video>`, so detection is driven by hand: each finished
detection kicks off the next, throttled by a one-in-flight flag.

```javascript
poseNet = ml5.poseNet(() => { poseReady = true; });   // no video arg — manual mode
poseNet.on('pose', gotPoses);

// in draw(), when the model is ready and a frame is available:
if (poseReady && !detecting) {
    detecting = true;
    poseNet.singlePose(imgEl)
        .then(() => { detecting = false; })    // release the lock either way, so a
        .catch(() => { detecting = false; });  // failed detection just retries next frame
}
```

Keypoints come back in the **stream's** pixel coordinates. The canvas scales the
whole frame once so points draw at their native `x`/`y`, and the marker size /
line weight are divided by `sx` so they stay a fixed on-screen size at any
frame resolution:

```javascript
const sx = width / imgEl.naturalWidth, sy = height / imgEl.naturalHeight;
push();
if (MIRROR) { translate(width, 0); scale(-1, 1); }
scale(sx, sy);
drawingContext.drawImage(imgEl, 0, 0);          // native size; scale() fits it
circle(kp.position.x, kp.position.y, 15 / sx);  // 15 px on screen, any resolution
pop();
```

Because `imgEl` is a raw `HTMLImageElement` (not a p5 image), it's drawn with the
canvas's own `drawingContext.drawImage()` rather than p5's `image()` — p5's
`image()` only accepts p5 image/element types.

---

## Adjusting the stream

`FRAME_SIZE` accepts any of the `FRAMESIZE_*` constants — bigger is sharper but
slower to stream *and* to run PoseNet on. See
[camera-stream → Adjusting the stream](../camera-stream/) for the full table and
the resolution/PSRAM notes. Keypoint positions and marker sizes are
resolution-independent, so changing `FRAME_SIZE` doesn't need any other edits.

---

## Troubleshooting

**Video shows but no keypoints appear**
- Give it a moment on first load — the PoseNet model downloads from the CDN
  (the placeholder reads "Loading PoseNet model…" until it's ready)
- Make sure a whole person is in frame with reasonable lighting
- Open the browser console: a *tainted canvas / SecurityError* means the frame
  was fetched without CORS — confirm the board runs the current
  `PardaloteCamera.h` (it sends `Access-Control-Allow-Origin: *`)

**Keypoints are offset from the body**
- The canvas and stream can be different sizes; positions scale by
  `width / naturalWidth`. If you changed the canvas dimensions, keep them the
  same aspect ratio (4:3) as the frame size, or the image (and points) stretch.

**Stream itself won't appear / low frame rate / PSRAM errors**
- These are camera-side, not pose-side — see
  [camera-stream → Troubleshooting](../camera-stream/).

**ml5 / PoseNet isn't defined**
- PoseNet lives in ml5 **0.12.x** (it was removed in ml5 1.0). `index.html`
  pins that version; if you swap the CDN link, keep it on the 0.12 line.

---

## Next steps

- Start from the plain video feed: [camera-stream](../camera-stream/)
- Drive hardware from the pose data — feed a joint angle to
  [servo-control](../servo-control/) or [bus-servos](../bus-servos/)
