// ==============================================================
// camera.js
// Pardalote Camera Extension
// Version v1.0
// by Scott Mitchell
// GPL-3.0 License
//
// Streams MJPEG video and fetches JPEG snapshots from an
// ESP32-S3 camera module via HTTP. Video never flows over the
// WebSocket — the browser connects to the Arduino's HTTP server
// directly, so MJPEG frames don't compete with control messages.
//
// Usage:
//   const arduino = new Arduino();
//   arduino.add('cam', new Camera());
//   arduino.connect('192.168.1.42');
//
//   arduino.on('ready', () => {
//       arduino.cam.attach(82);   // start camera HTTP server on port 82
//   });
//
//   arduino.cam.on('stream', ({ url, element }) => {
//       // element is a ready <img> — pass it to p5.js image() or
//       // append it to the DOM directly.
//       document.body.appendChild(element);
//   });
//
// p5.js integration:
//   let camEl;
//   arduino.cam.on('stream', ({ element }) => { camEl = element; });
//
//   function draw() {
//       if (camEl) image(camEl, 0, 0);
//       loadPixels();  // pixels[] now contains the camera frame
//   }
//
// Note: loadPixels() requires the ESP32 to send CORS headers, which
// CameraExtension.h sets automatically on both HTTP endpoints.
// ==============================================================

const DEVICE_CAMERA = 204;

const CMD_CAMERA_INIT        = 0x30;
const CMD_CAMERA_SET_RES     = 0x31;
const CMD_CAMERA_SET_QUALITY = 0x32;

// -------------------------------------------------------------------
// Framesize constants — mirror ESP32 camera framesize_t enum values.
// Pass one of these to setResolution().
// -------------------------------------------------------------------
const FRAMESIZE_96X96   = 0;
const FRAMESIZE_QQVGA   = 1;   // 160×120
const FRAMESIZE_QCIF    = 2;   // 176×144
const FRAMESIZE_HQVGA   = 3;   // 240×176
const FRAMESIZE_240X240 = 4;
const FRAMESIZE_QVGA    = 5;   // 320×240  ← default
const FRAMESIZE_CIF     = 6;   // 400×296
const FRAMESIZE_HVGA    = 7;   // 480×320
const FRAMESIZE_VGA     = 8;   // 640×480
const FRAMESIZE_SVGA    = 9;   // 800×600
const FRAMESIZE_XGA     = 10;  // 1024×768
const FRAMESIZE_HD      = 11;  // 1280×720

class Camera extends Extension {
    static deviceId = DEVICE_CAMERA;

    constructor() {
        super();

        this._port        = null;    // null until attach() is called
        this._streamUrl   = null;
        this._snapshotUrl = null;
        this._el          = null;    // <img> element pointing at the stream
        this._pendingInit = false;   // true when we sent CMD_CAMERA_INIT and await confirmation

        this.framesize = FRAMESIZE_QVGA;
        this.quality   = 12;         // 0 = best, 63 = worst (ESP32 convention)
    }

    // -------------------------------------------------------------------
    // Reconnection — called by Arduino core after every reconnect.
    // Re-sends CMD_CAMERA_INIT so the Arduino reconfirms the stream port.
    // -------------------------------------------------------------------
    _reRegister() {
        if (this._port !== null) this._sendInit();
    }

    // -------------------------------------------------------------------
    // attach(port?)
    // Start the camera HTTP server on the Arduino.
    // Emits 'stream' when the Arduino confirms. Default port is 82.
    // -------------------------------------------------------------------
    attach(port = 82) {
        this._port = port;
        this._sendInit();
        return this;
    }

    _sendInit() {
        this._pendingInit = true;
        this.arduino.send(encodeFrame(
            CMD_CAMERA_INIT, DEVICE_CAMERA,
            [this.logicalId, this._port]
        ));
    }

    // -------------------------------------------------------------------
    // detach()
    // Clear the local stream reference and stop pointing the img element
    // at the stream. The HTTP server keeps running on the Arduino.
    // -------------------------------------------------------------------
    detach() {
        if (this._el) {
            this._el.src = '';
            this._el     = null;
        }
        this._port        = null;
        this._streamUrl   = null;
        this._snapshotUrl = null;
        this._pendingInit = false;
        return this;
    }

    // -------------------------------------------------------------------
    // setResolution(framesize)
    // Change the camera frame size. Use the FRAMESIZE_* constants above.
    // Takes effect on the next captured frame.
    // -------------------------------------------------------------------
    setResolution(framesize) {
        this.framesize = framesize;
        this.arduino.send(encodeFrame(
            CMD_CAMERA_SET_RES, DEVICE_CAMERA,
            [this.logicalId, framesize]
        ));
        return this;
    }

    // -------------------------------------------------------------------
    // setQuality(q)
    // JPEG quality: 0 = best image, highest bandwidth.
    //               63 = worst image, lowest bandwidth.
    // Lower values (better quality) increase frame size and reduce fps.
    // -------------------------------------------------------------------
    setQuality(quality) {
        this.quality = Math.max(0, Math.min(63, Math.round(quality)));
        this.arduino.send(encodeFrame(
            CMD_CAMERA_SET_QUALITY, DEVICE_CAMERA,
            [this.logicalId, this.quality]
        ));
        return this;
    }

    // -------------------------------------------------------------------
    // getElement()
    // Returns the <img> DOM element pointed at the live MJPEG stream.
    // Pass directly to p5's image(), or append to the DOM.
    // Returns null if attach() has not been called yet.
    // -------------------------------------------------------------------
    getElement() {
        if (!this._streamUrl) return null;
        if (!this._el) {
            this._el = document.createElement('img');
            this._el.src = this._streamUrl;
        }
        return this._el;
    }

    // -------------------------------------------------------------------
    // snapshot()
    // Fetch a single JPEG still from the Arduino over HTTP.
    // Returns a Promise that resolves to a blob: URL, or null on error.
    // The 'snapshot' event fires with { url, blob } when the image arrives.
    //
    // Revoke the returned URL when you're done with it:
    //   URL.revokeObjectURL(url);
    // -------------------------------------------------------------------
    async snapshot() {
        if (!this._snapshotUrl) {
            console.warn('Camera: call attach() before snapshot()');
            return null;
        }
        try {
            const res = await fetch(this._snapshotUrl);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const blob = await res.blob();
            const url  = URL.createObjectURL(blob);
            this._emit('snapshot', { url, blob });
            return url;
        } catch (e) {
            console.error('Camera: snapshot failed —', e.message);
            this._emit('error', { message: e.message });
            return null;
        }
    }

    // -------------------------------------------------------------------
    // Callback shortcuts
    // -------------------------------------------------------------------
    onStream(fn)   { return this.on('stream',   fn); }
    onSnapshot(fn) { return this.on('snapshot', fn); }
    onError(fn)    { return this.on('error',    fn); }

    // -------------------------------------------------------------------
    // State snapshot
    // -------------------------------------------------------------------
    getState() {
        return {
            logicalId:   this.logicalId,
            port:        this._port,
            streamUrl:   this._streamUrl,
            snapshotUrl: this._snapshotUrl,
            framesize:   this.framesize,
            quality:     this.quality,
        };
    }

    // -------------------------------------------------------------------
    // Incoming frames from Arduino.
    // CMD_CAMERA_INIT arrives when the HTTP server is confirmed live.
    // -------------------------------------------------------------------
    handleMessage(frame) {
        if (frame.cmd !== CMD_CAMERA_INIT) return;

        // Only rebuild when we sent this init — not when another client's
        // CMD_CAMERA_INIT causes the Arduino to broadcast to everyone.
        if (!this._pendingInit) return;
        this._pendingInit = false;

        const port = frame.params[1];
        const ip   = this._extractIp();
        if (!ip) return;

        // Append a cache-buster so the browser opens a fresh TCP connection
        // on every reconnect, even when the Arduino's IP:port is unchanged.
        // The Arduino's wildcard URI handler strips the query string before routing.
        const t = Date.now();
        this._streamUrl   = `http://${ip}:${port}/stream?_t=${t}`;
        this._snapshotUrl = `http://${ip}:${port}/snapshot`;

        // Abort any old lazy element before the stream event fires so the
        // browser closes the previous MJPEG connection immediately.
        if (this._el) {
            this._el.src = '';
            this._el = null;
        }

        this._emit('stream', {
            url:     this._streamUrl,
            element: null,
        });
    }

    // -------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------

    // Extract the bare IP from arduino.deviceIP ("ws://ip:port/").
    _extractIp() {
        const m = this.arduino.deviceIP && this.arduino.deviceIP.match(/ws:\/\/([^:/]+)/);
        if (!m) { console.error('Camera: cannot parse Arduino IP'); return null; }
        return m[1];
    }
}
