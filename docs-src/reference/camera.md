title: Camera
lede: MJPEG video and JPEG snapshots from ESP32 camera boards, served over HTTP so video never competes with control messages.
---
The camera extension streams MJPEG video and serves JPEG snapshots over a **separate HTTP server** — video never flows through the WebSocket, so it doesn't compete with control messages.

Requires no third-party library beyond the ESP32 Arduino core (which includes `esp_camera` and `esp_http_server`). PSRAM must be present **and enabled in the build** — on the Seeed XIAO ESP32S3 that means **Tools → PSRAM → `OPI PSRAM`**. Without it the camera falls back to a single QQVGA buffer in internal RAM (poor image, `setResolution()` triggers `cam_hal: FB-OVF`); see [Troubleshooting](troubleshooting.html#camera-poor-image-quality-stuck-at-low-resolution-or-cam_hal-fb-ovf-in-the-serial-monitor).

## Arduino setup

Define your board model **before** including the camera header:

```cpp sketch.ino — camera setup
#define CAMERA_MODEL_WROVER_KIT
#include <PardaloteCamera.h>
```

Board define names match the ESP CameraWebServer example:

| Board | Define |
|---|---|
| Freenove ESP32-WROVER-DEV | `CAMERA_MODEL_WROVER_KIT` |
| AI-Thinker ESP32-CAM | `CAMERA_MODEL_AI_THINKER` |
| Seeed Studio XIAO ESP32S3 Sense | `CAMERA_MODEL_XIAO_ESP32S3` |
| Espressif ESP32-S3-EYE | `CAMERA_MODEL_ESP32S3_EYE` |
| Freenove ESP32-S3-WROOM CAM | `CAMERA_MODEL_ESP32S3_EYE` (same camera pins) |
| Espressif ESP-EYE | `CAMERA_MODEL_ESP_EYE` |
| M5Stack PSRAM | `CAMERA_MODEL_M5STACK_PSRAM` |
| M5Stack V2 PSRAM | `CAMERA_MODEL_M5STACK_V2_PSRAM` |
| M5Stack Wide | `CAMERA_MODEL_M5STACK_WIDE` |
| M5Stack ESP32CAM | `CAMERA_MODEL_M5STACK_ESP32CAM` |
| M5Stack UnitCam | `CAMERA_MODEL_M5STACK_UNITCAM` |
| M5Stack CamS3 Unit | `CAMERA_MODEL_M5STACK_CAMS3_UNIT` |
| TTGO T-Journal | `CAMERA_MODEL_TTGO_T_JOURNAL` |
| ESP32-CAM Board | `CAMERA_MODEL_ESP32_CAM_BOARD` |
| ESP32-S3 CAM LCD | `CAMERA_MODEL_ESP32S3_CAM_LCD` |
| ESP32-S2 CAM Board | `CAMERA_MODEL_ESP32S2_CAM_BOARD` |
| DFRobot FireBeetle 2 ESP32-S3 | `CAMERA_MODEL_DFRobot_FireBeetle2_ESP32S3` |
| DFRobot Romeo ESP32-S3 | `CAMERA_MODEL_DFRobot_Romeo_ESP32S3` |

**Freenove ESP32-S3-WROOM CAM:** set Tools → PSRAM → `OPI PSRAM`. The board has two USB-C ports — on the one marked **UART**, set Tools → USB CDC On Boot → **Disabled**; on the one marked **USB**, set it to **Enabled** (the wrong setting shows only the boot banner in the Serial Monitor, with no WiFi `w` menu). Some of these boards ship a GC0308 camera, which can't make JPEGs in hardware: Pardalote encodes its frames in software instead (Serial prints `No hardware JPEG — encoding in software`), so keep it at `FRAMESIZE_QVGA` or `FRAMESIZE_HVGA` for a usable frame rate.

Examples below assume:

```javascript
arduino.add('cam', new Camera());
```

## attach()

Starts the camera HTTP server. Call inside `on('ready')`.

<div class="sig">arduino.cam.<span class="fn">attach</span>(port)</div>

| Parameter | Type | Description |
|---|---|---|
| `port` | number | HTTP port for the camera server, e.g. `82`. |

```javascript Example — start the stream
arduino.on('ready', () => {
    arduino.cam.attach(82);
});
arduino.cam.on('stream', ({ url, element }) => {
    // element is a live <img> — append to DOM or use url with p5.js createImg()
    document.body.appendChild(element);
});
```

## setResolution()

Frame size, using constants that match the ESP32 camera `framesize_t` enum.

<div class="sig">arduino.cam.<span class="fn">setResolution</span>(framesize)</div>

| Constant | Resolution |
|---|---|
| `FRAMESIZE_QQVGA` | 160×120 |
| `FRAMESIZE_QVGA` | 320×240 (default) |
| `FRAMESIZE_HVGA` | 480×320 |
| `FRAMESIZE_VGA` | 640×480 |
| `FRAMESIZE_SVGA` | 800×600 |
| `FRAMESIZE_HD` | 1280×720 |

Call it before or after `attach()` — either way the chosen size is applied once the stream starts, and it persists across reconnects.

With PSRAM, the board sets aside room for frames up to 1600×1200 when the camera starts (about 770 KB of PSRAM), so switching to a bigger size while streaming, or a very detailed scene at high quality, still fits. The exception is a sensor without hardware JPEG (such as the GC0308): its frame size is fixed when the camera starts, so a new size takes effect on the next `attach()` (for example after a page reload), not mid-stream.

`FRAMESIZE_HD` streams on the XIAO ESP32S3's OV2640, including when you switch to it mid-stream. The largest sizes need PSRAM and push the sensor hard. If a size drops frames (`cam_hal: FB-OVF` in the Serial Monitor), first update the Pardalote Arduino library — older versions left too little buffer room for large frames — then step down a size. See [Troubleshooting](troubleshooting.html#camera-framesize_hd-gives-cam_hal-fb-ovf--neterr_incomplete_chunked_encoding-even-with-psram-on).

## setQuality()

JPEG compression level.

<div class="sig">arduino.cam.<span class="fn">setQuality</span>(quality)</div>

| Parameter | Type | Description |
|---|---|---|
| `quality` | number | `0` = best image / highest bandwidth, `63` = worst / lowest. Default `12` — a good streaming balance. |

## snapshot()

Fetches a single JPEG still over HTTP.

<div class="sig">await arduino.cam.<span class="fn">snapshot</span>()</div>

**Returns** a `blob:` URL — use as an image src, revoke with `URL.revokeObjectURL(url)` when done. Also fires the `'snapshot'` event with `{ url, blob }`.

## detach() / getElement()

<div class="sig">arduino.cam.<span class="fn">detach</span>() · arduino.cam.<span class="fn">getElement</span>()</div>

`detach()` clears the local stream reference (the HTTP server keeps running on the board). `getElement()` returns the live `<img>` element.

## Events

<div class="sig">arduino.cam.<span class="fn">on</span>(event, handler)</div>

| Event | Payload | Fires when |
|---|---|---|
| `'stream'` | `{ url, element }` | The stream is confirmed live. |
| `'snapshot'` | `{ url, blob }` | A still is received. |
| `'error'` | `{ message }` | A fetch failed. |

Shorthand: `onStream(fn)`, `onSnapshot(fn)`, `onError(fn)`.

## p5.js integration

```javascript sketch.js — draw the stream to a p5.js canvas
let camEl;

arduino.cam.on('stream', ({ url }) => {
    if (camEl) camEl.remove();
    camEl = createImg(url, '');  // wrap in p5.Element so image() accepts it
    camEl.hide();                // keep it out of the DOM layout
});

function draw() {
    if (camEl) {
        camEl.width  = camEl.elt.naturalWidth;    // p5 records the size of the first frame only;
        camEl.height = camEl.elt.naturalHeight;   // keep it current across resolution changes
        image(camEl, 0, 0, width, height);  // draw MJPEG frame to canvas
        loadPixels();                        // pixels[] available for manipulation
    }
}
```

`loadPixels()` works because `PardaloteCamera.h` sets `Access-Control-Allow-Origin: *` on both HTTP endpoints automatically.

## HTTP endpoints

| Endpoint | Description |
|---|---|
| `http://<ip>:<port>/stream` | MJPEG stream |
| `http://<ip>:<port+1>/snapshot` | Single JPEG, answered even while a stream is running. |

`snapshot()` builds these URLs for you. Snapshots have a web server of their own on the next port (`attach(82)` → `83`; if that's the WebSocket's `81`, the one after), because the board's stream server is busy for the whole time a stream is open — a snapshot on the stream's port would wait until the stream closed. `/snapshot` also still answers on the stream port, for older versions of the JS library, but only while no stream is running.

## State snapshot

<div class="sig">arduino.cam.<span class="fn">getState</span>()</div>

**Returns** `{ logicalId, port, streamUrl, snapshotUrl, framesize, quality }`.

## Limitations

Only one browser can receive the MJPEG stream at a time. This is a fundamental limitation of the ESP32 camera driver — `esp_camera_fb_get()` is single-consumer by design. A second browser connecting will see a black screen and only receives the feed once the first disconnects. This behaviour is identical to Espressif's own CameraWebServer example.

See also: [Camera example](../examples/camera-stream.html)
