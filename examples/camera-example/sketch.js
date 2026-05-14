// ==============================================================
// Camera Example
// Streams MJPEG video from an ESP32-S3 camera into a p5.js canvas.
// by Scott Mitchell
// GPL-3.0 License
// ==============================================================

const ARDUINO_IP  = '10.1.1.149';  // update to match your Arduino
const CAMERA_PORT = 82;

let arduino;
let camEl = null;   // <img> element pointing at the MJPEG stream

function setup() {
    createCanvas(640, 480);

    arduino = new Arduino();
    arduino.add('cam', new Camera());
    arduino.connect(ARDUINO_IP);

    arduino.on('ready', () => {
        arduino.cam.attach(CAMERA_PORT);
    });

    arduino.cam.on('stream', ({ url }) => {
        if (camEl) camEl.remove();
        camEl = createImg(url, '');
        camEl.hide();
    });
}

function draw() {
    background(30);

    if (camEl) {
        try {
            image(camEl, 0, 0, width, height);
        } catch (e) {
            // img entered broken state (stream dropped) — clear and show placeholder
            camEl.remove();
            camEl = null;
        }
    } else {
        // Waiting for stream — show a placeholder message
        fill(80);
        noStroke();
        rect(0, 0, width, height);
        fill(200);
        textAlign(CENTER, CENTER);
        textSize(16);
        text(arduino.connected ? 'Starting camera…' : 'Connecting…', width / 2, height / 2);
    }

    // Connection status dot — top-right corner
    noStroke();
    fill(arduino.connected ? color(60, 200, 80) : color(200, 50, 60));
    circle(width - 16, 16, 12);
}
