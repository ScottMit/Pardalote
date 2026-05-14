# Camera Example

Streams live MJPEG video from an ESP32 camera module into a p5.js canvas over WiFi.

Video is served over a separate HTTP connection — it does not flow through the WebSocket control channel, so camera streaming and Arduino control can run simultaneously without interfering with each other.

---

## What you need

- An ESP32 board with a camera module and PSRAM (see supported boards below)
- The board flashed with `Pardalote.ino` and `CameraExtension.h` enabled
- A web browser on the same WiFi network

---

## Files

| File | Purpose |
|---|---|
| `index.html` | Loads p5.js, Pardalote, and the sketch |
| `sketch.js` | p5.js sketch — connects, streams, draws |
| `style.css` | Minimal page reset |

---

## Arduino setup

### 1. Select your board

In `Pardalote.ino`, uncomment the define that matches your hardware:

```cpp
// Uncomment ONE:
#define CAMERA_MODEL_WROVER_KIT               // Freenove ESP32-WROVER-DEV
// #define CAMERA_MODEL_AI_THINKER            // AI-Thinker ESP32-CAM
// #define CAMERA_MODEL_XIAO_ESP32S3          // Seeed XIAO ESP32S3 Sense
// #define CAMERA_MODEL_ESP32S3_EYE           // Espressif ESP32-S3-EYE
// #define CAMERA_MODEL_M5STACK_PSRAM         // M5Stack PSRAM
// #define CAMERA_MODEL_M5STACK_WIDE          // M5Stack Wide
// ... (see CameraExtension.h for all supported models)
#include "CameraExtension.h"
```

### 2. Upload

Flash `Pardalote.ino` to your board. Once connected to WiFi, the IP address is printed in the Serial Monitor (115200 baud).

---

## Browser setup

### 1. Set the IP address

Open `sketch.js` and update the Arduino IP address:

```javascript
const ARDUINO_IP  = '10.1.1.128';  // ← your Arduino's IP
const CAMERA_PORT = 82;             // ← port for the camera HTTP server
```

`CAMERA_PORT` can be any unused port. `82` is the default — change it only if something else on your network uses that port.

### 2. Open the example

Serve the folder from a local web server and open `index.html` in a browser. You can use any static server — for example:

```
npx serve .
```
If you are using a code editor you can run the web server there.

> **Why a server?** Browsers block WebSocket connections from `file://` pages on some platforms. A local server avoids this.

---

## How it works

```
Arduino                          Browser
────────────────────────────────────────────────────────
WebSocket :81  ←──── control ────→  pardalote.js / camera.js
HTTP      :82  ──── MJPEG stream ──→  <img src="http://ip:82/stream">
```

1. `arduino.connect()` opens a WebSocket on port 81.
2. On `ready`, `arduino.cam.attach(CAMERA_PORT)` sends a `CMD_CAMERA_INIT` frame to the Arduino over the WebSocket. The Arduino initialises the camera hardware and starts an HTTP server on the requested port.
3. The Arduino echoes the confirmed port back. `camera.js` sets an `<img>` element's `src` to `http://<ip>:<port>/stream` and emits the `stream` event.
4. The browser fetches the MJPEG stream directly over HTTP — the WebSocket is only used for the initial handshake and any subsequent control commands (resolution, quality).
5. In `draw()`, `image(camEl, 0, 0, width, height)` renders the current frame to the p5.js canvas.

---

## Adjusting the stream

```javascript
// Resolution — call before or after attach()
arduino.cam.setResolution(FRAMESIZE_QVGA);   // 320×240  ← default
arduino.cam.setResolution(FRAMESIZE_VGA);    // 640×480
arduino.cam.setResolution(FRAMESIZE_HD);     // 1280×720

// JPEG quality: 0 = best image / highest bandwidth
//              63 = worst image / lowest bandwidth
arduino.cam.setQuality(12);  // default
```

| Constant | Resolution |
|---|---|
| `FRAMESIZE_QQVGA` | 160×120 |
| `FRAMESIZE_QVGA` | 320×240 |
| `FRAMESIZE_HVGA` | 480×320 |
| `FRAMESIZE_VGA` | 640×480 |
| `FRAMESIZE_SVGA` | 800×600 |
| `FRAMESIZE_HD` | 1280×720 |

Higher resolutions require more bandwidth and may reduce frame rate. QVGA is a good starting point for most WiFi environments.

---

## Snapshots

Capture a single JPEG still without interrupting the stream:

```javascript
const url = await arduino.cam.snapshot();
// url is a blob: URL — use as an <img> src or save it
// revoke when done to free memory:
URL.revokeObjectURL(url);
```

The snapshot is served from `http://<ip>:<port>/snapshot` — a separate endpoint from the stream.

---

## Pixel manipulation

Because the camera HTTP server sends `Access-Control-Allow-Origin: *`, p5.js can read pixel data from the stream:

```javascript
arduino.cam.on('stream', ({ url }) => {
    camEl = createImg(url, '');
    camEl.hide();
});

function draw() {
    if (camEl) {
        image(camEl, 0, 0, width, height);
        loadPixels();
        // pixels[] is now available — RGBA values for every canvas pixel
        for (let i = 0; i < pixels.length; i += 4) {
            pixels[i] = 255 - pixels[i];     // invert red
            pixels[i+1] = 255 - pixels[i+1]; // invert green
            pixels[i+2] = 255 - pixels[i+2]; // invert blue
        }
        updatePixels();
    }
}
```

Note: `loadPixels()` on every frame is CPU-intensive. For heavy processing, consider drawing to an off-screen `createGraphics()` buffer and only calling `loadPixels()` on that.

---

## Troubleshooting

**Stream doesn't appear**
- Check that `ARDUINO_IP` and `CAMERA_PORT` in `sketch.js` are correct
- Open `http://<ip>:<port>/stream` directly in a browser tab — if you see video there, the Arduino is working and the issue is in the JS
- Check the browser console for errors

**"Camera Init failed: 0x106 (ESP_ERR_NOT_SUPPORTED)"**
- Wrong board define — the camera sensor PID didn't match. Select the correct `CAMERA_MODEL_*` for your hardware and re-flash.

**Low frame rate**
- Reduce resolution with `setResolution(FRAMESIZE_QVGA)` or increase quality number (lower quality) with `setQuality(20)`
- Move the Arduino closer to the WiFi access point
- Disable WiFi modem sleep — Pardalote does this automatically with `WiFi.setSleep(false)`

**XIAO ESP32S3 won't connect to WiFi**
- The Sense board has a u.FL connector for an external antenna. If the antenna switch is set to external and nothing is plugged in, the radio has no antenna and cannot connect. Either attach an external antenna or move the antenna switch to the internal position.

**Canvas size doesn't match stream**
- The canvas size and stream resolution are independent. `image(camEl, 0, 0, width, height)` scales the stream to fill the canvas. Adjust `createCanvas()` dimensions to match your desired aspect ratio.
