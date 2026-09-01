// ==============================================================
// Camera stream — p5.js + Pardalote
// Streams MJPEG video from an ESP32-S3 camera into a p5.js canvas. There's no
// pin to set — the camera's stream port is fixed by the firmware.
//
// The on-page Board controls (WiFi / USB, remembered IP, Connect) live in
// connect.js — this file is just the lesson. The video is served straight from
// the board's IP over HTTP, so the stream needs a WiFi connection.
// by Scott Mitchell — GPL-3.0-or-later License
// ==============================================================

const CAMERA_PORT = 82;

// Camera frame size — bigger is sharper but slower and uses more bandwidth.
// Options: FRAMESIZE_QVGA 320×240 · FRAMESIZE_HVGA 480×320 · FRAMESIZE_VGA 640×480
//          · FRAMESIZE_SVGA 800×600 · FRAMESIZE_HD 1280×720 (needs PSRAM)
const FRAME_SIZE = FRAMESIZE_VGA;   // 640×480 — matches the canvas

let arduino, camEl = null;   // <img> pointed at the MJPEG stream

function setup() {
    createCanvas(640, 480);

    arduino = new Arduino();
    arduino.add('cam', new Camera());
    setupConnection(arduino, { store: 'pardalote-camera-stream' });

    // Start the camera once the board is ready (device state resets on reconnect).
    arduino.on('ready', () => {
        arduino.cam.setResolution(FRAME_SIZE);
        arduino.cam.attach(CAMERA_PORT);
    });

    // The stream URL arrives here — point a hidden <img> at it for image().
    arduino.cam.on('stream', ({ url }) => {
        if (camEl) camEl.remove();
        camEl = createImg(url, '');
        camEl.hide();
    });
    arduino.on('disconnect', () => { if (camEl) { camEl.remove(); camEl = null; } });
}

function draw() {
    background(255);

    if (camEl) {
        try {
            image(camEl, 0, 0, width, height);
        } catch (e) {
            // img entered broken state (stream dropped) — clear and show placeholder
            camEl.remove();
            camEl = null;
        }
    } else {
        // Waiting for stream — show a placeholder message (house cream card)
        fill('#F2E9D8'); noStroke();
        rect(0, 0, width, height);
        fill('#6d6a5f');
        textAlign(CENTER, CENTER); textSize(16);
        text(arduino.connected ? 'Starting camera…' : 'Connecting…', width / 2, height / 2);
        textAlign(LEFT, BASELINE);
    }

    // Connection status dot — top-right corner (teal = connected)
    noStroke();
    fill(arduino.connected ? '#3FA9A0' : '#D3542B');
    circle(width - 16, 16, 12);
}
