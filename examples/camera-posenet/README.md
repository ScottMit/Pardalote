# Camera Pose

Runs Google's [MediaPipe](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker)
**Pose Landmarker** on the live MJPEG video from an ESP32 camera — green dots
track a person's body landmarks and white lines connect them into a skeleton,
all in a p5.js canvas.

It's the [camera-stream](../camera-stream/) example with pose detection layered
on top: instead of pointing the pose model at a webcam (`createCapture(VIDEO)`),
it points it at the board's video stream.

---

## What you need

- An ESP32 board with a camera module and PSRAM, flashed with the **camera-stream**
  firmware (see [camera-stream](../camera-stream/) — the same `<PardaloteCamera.h>`
  sketch drives this example; there's nothing new to upload)
- A web browser on the same WiFi network, with internet access the first time
  (MediaPipe and its model are loaded from a CDN)

The stream is served over HTTP straight from the board's IP, so this example
needs a **WiFi** connection — USB carries only the control link, not video.

---

## Files

| File | Purpose |
|---|---|
| `index.html` | Loads p5.js, Pardalote, and the sketch |
| `sketch.js` | Loads MediaPipe, connects, streams, runs pose detection, draws landmarks + skeleton |
| `connect.js` | Board connection UI (WiFi / USB, remembered per browser) |
| `style.css` | Pardalote example house style |

---

## Browser setup

Open `index.html` from a local web server (browsers block some connections from
`file://` pages — `npx serve .` works). In the **Board** row enter the board's
IP and press **Connect** — the setting is remembered per browser. The model
loads on its own; once video arrives, landmarks appear over it.

The settings live at the top of `sketch.js`:

```javascript
const FRAME_SIZE     = FRAMESIZE_VGA;   // 640×480 — matches the canvas
const MIRROR_VIDEO   = true;            // flip left-to-right, like a webcam selfie
const POSE_MODEL     = 'lite';          // 'lite' (fastest), 'full', or 'heavy' (most accurate)
const NUM_POSES      = 1;               // how many people to track
const DETECT_FPS     = 15;              // detections per second
const MIN_VISIBILITY = 0.5;             // hide landmarks the model can't really see
```

An outward-facing ESP32 camera usually shouldn't be mirrored — set
`MIRROR_VIDEO` to `false` if movement looks backwards.

---

## How it works

### Loading MediaPipe

There's no `<script>` tag for MediaPipe. `sketch.js` loads the
[Tasks Vision](https://www.npmjs.com/package/@mediapipe/tasks-vision) library
with `import()` — which works from an ordinary script, so p5's global mode keeps
working — then builds a Pose Landmarker. It tries the GPU first and falls back
to the CPU if the browser's GPU support fails:

```javascript
const { PoseLandmarker, FilesetResolver } = await import(MP_URL);
const vision = await FilesetResolver.forVisionTasks(`${MP_URL}/wasm`);
poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
    runningMode: 'VIDEO',      // track frame to frame — smoother than per-image
    numPoses: NUM_POSES,
});
```

Straight after loading, the sketch runs one detection on a small blank canvas.
The very first detection sets up the GPU and can freeze the page for several
seconds; doing it at load time, before you press **Connect**, stops that freeze
landing mid-stream, where it could look like a dropped board connection.

The library version is pinned (`MP_VERSION`) so a MediaPipe release can't break
the example.

### Reading the stream

The one real difference from a webcam is **where the pixels come from**:

```javascript
// A raw <img>, loaded cross-origin so MediaPipe may READ its pixels. crossOrigin
// MUST be set before src, or the pixel read throws a tainted-canvas error. This
// works because PardaloteCamera.h serves Access-Control-Allow-Origin: *.
imgEl = new Image();
imgEl.crossOrigin = 'anonymous';
imgEl.src = url;                    // the MJPEG stream URL, from cam.on('stream')
```

The stream isn't a `<video>`, so there's no event for "new frame". Instead
`draw()` calls `detectPoses()`, which runs the model on whatever frame the
`<img>` is showing, capped at `DETECT_FPS`:

```javascript
function detectPoses() {
    const now = performance.now();
    if (!poseLandmarker || now - lastDetect < 1000 / DETECT_FPS) return;
    lastDetect = now;
    poses = poseLandmarker.detectForVideo(imgEl, now).landmarks;
}
```

`detectForVideo()` is synchronous — the results are ready as soon as it
returns. That also means it runs on the page's main thread, which is why it's
capped: the rest of each second is left for drawing and for Pardalote's
connection to the board.

### Drawing the landmarks

Each person comes back as an array of **33 landmarks** (nose, eyes, shoulders,
elbows, wrists, hands, hips, knees, ankles, heels and toes — see MediaPipe's
[landmark map](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker)
for which number is which). Each landmark has:

- `x`, `y` — position as a fraction of the frame (0–1), so multiply by the
  canvas `width` / `height`
- `z` — rough depth, relative to the hips (smaller = closer to the camera)
- `visibility` — 0–1, how likely the point is in frame and not hidden

`PoseLandmarker.POSE_CONNECTIONS` lists the skeleton's bones as
`{ start, end }` landmark index pairs:

```javascript
for (let { start, end } of poseConnections) {
    const a = landmarks[start], b = landmarks[end];
    if (a.visibility < MIN_VISIBILITY || b.visibility < MIN_VISIBILITY) continue;
    line(a.x * width, a.y * height, b.x * width, b.y * height);
}
```

Because the positions are fractions of the frame, they don't depend on the
stream's resolution — changing `FRAME_SIZE` needs no other edits.

The frame itself is drawn with the canvas's own `drawingContext.drawImage()`
rather than p5's `image()`, because `imgEl` is a raw `HTMLImageElement` and p5's
`image()` only accepts p5 image/element types.

---

## Adjusting the stream

`FRAME_SIZE` accepts any of the `FRAMESIZE_*` constants — bigger is sharper but
slower to stream *and* to run pose detection on. See
[camera-stream → Adjusting the stream](../camera-stream/) for the full table and
the resolution/PSRAM notes.

If detection lags, lower `DETECT_FPS`, use a smaller `FRAME_SIZE`, or stay on the
`'lite'` model. If tracking is too rough, try `'full'`.

---

## Troubleshooting

**Video shows but no landmarks appear**
- Give it a moment on first load — MediaPipe and the model download from the CDN
  (the placeholder reads "Loading pose model…" until it's ready)
- Make sure a person's upper body or whole body is in frame with reasonable lighting
- Open the browser console: a *tainted canvas / SecurityError* means the frame
  was fetched without CORS — confirm the board runs the current
  `PardaloteCamera.h` (it sends `Access-Control-Allow-Origin: *`)

**"Pose model failed to load"**
- The page needs internet access to reach `cdn.jsdelivr.net` and
  `storage.googleapis.com`. The console shows the underlying error.

**"MediaPipe GPU delegate failed, falling back to CPU" in the console**
- Harmless — the browser's GPU support didn't work, so detection runs on the CPU.
  It will be slower; lower `DETECT_FPS` if drawing becomes choppy.

**Landmarks are offset from the body**
- The frame is stretched to the canvas. If you changed the canvas dimensions,
  keep them the same aspect ratio (4:3) as the frame size, or the image (and
  landmarks) stretch.

**Stream itself won't appear / low frame rate / PSRAM errors**
- These are camera-side, not pose-side — see
  [camera-stream → Troubleshooting](../camera-stream/).

---

## Next steps

- Start from the plain video feed: [camera-stream](../camera-stream/)
- Drive hardware from the pose data — feed a joint angle to
  [servo-control](../servo-control/) or [bus-servos](../bus-servos/)
- MediaPipe has sibling models that load the same way — `HandLandmarker`
  (21 points per hand) and `FaceLandmarker` (478-point face mesh)
