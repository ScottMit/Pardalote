// ==============================================================
// Camera PoseNet — p5.js + Pardalote
// Runs ml5.js PoseNet on the MJPEG video streamed from an ESP32-S3 camera,
// instead of a local webcam (createCapture). There's no pin to set — the
// camera's stream port is fixed by the firmware.
//
// The only real difference vs. a webcam: the video arrives as a cross-origin
// MJPEG <img>. PoseNet has to READ pixels from it, so the <img> is loaded with
// crossOrigin='anonymous' — which works because PardaloteCamera.h serves
// Access-Control-Allow-Origin: *. The stream is HTTP-direct to the board's IP,
// so PoseNet video needs a WiFi connection.
//
// The on-page Board controls (WiFi / USB, remembered IP, Connect) live in
// connect.js — this file is just the lesson.
// by Scott Mitchell — GPL-3.0-or-later License
// ==============================================================

const CAMERA_PORT = 82;

// Camera frame size — bigger is sharper but slower to stream and detect.
// Options: FRAMESIZE_QVGA 320×240 · FRAMESIZE_HVGA 480×320 · FRAMESIZE_VGA 640×480
//          · FRAMESIZE_SVGA 800×600 · FRAMESIZE_HD 1280×720 (needs PSRAM)
const FRAME_SIZE = FRAMESIZE_VGA;   // 640×480 — matches the canvas

// Flip the image left-to-right. A webcam selfie is usually mirrored.
const MIRROR = true;

let arduino;
let imgEl = null;                 // raw <img> holding the live MJPEG stream

// --- ml5 PoseNet --------------------------------------------------------
let poseNet, poseReady = false, detecting = false;
let poses = [];

function setup() {
    createCanvas(640, 480);

    // Load the PoseNet model up front so it's warm by the time video arrives.
    // No video is passed here: the stream isn't a <video>, so we drive
    // detection ourselves with singlePose() once frames start arriving.
    poseNet = ml5.poseNet(() => { poseReady = true; });
    poseNet.on('pose', gotPoses);

    arduino = new Arduino();
    arduino.add('cam', new Camera());
    setupConnection(arduino, { store: 'pardalote-camera-posenet' });

    // Start the camera once the board is ready (device state resets on reconnect).
    arduino.on('ready', () => {
        arduino.cam.setResolution(FRAME_SIZE);
        arduino.cam.attach(CAMERA_PORT);
    });
    arduino.cam.on('stream', ({ url }) => attachStream(url));
    arduino.on('disconnect', clearStream);
}

// Build a fresh cross-origin <img> for the MJPEG stream. crossOrigin MUST be
// set BEFORE src, or the browser fetches without CORS and PoseNet's pixel read
// throws a tainted-canvas SecurityError.
function attachStream(url) {
    clearStream();
    imgEl = new Image();
    imgEl.crossOrigin = 'anonymous';
    imgEl.src = url;
}
function clearStream() {
    if (imgEl) { imgEl.src = ''; imgEl = null; }
    poses = [];
}

// PoseNet 'pose' event — same payload as the webcam path: [{ pose, skeleton }].
function gotPoses(results) {
    poses = results;
}

function draw() {
    background(0);

    if (imgEl && imgEl.naturalWidth > 0) {
        const srcW = imgEl.naturalWidth, srcH = imgEl.naturalHeight;
        const sx = width / srcW, sy = height / srcH;   // stream → canvas scale

        // Kick off a detection when the previous one has resolved. singlePose
        // runs on the raw <img>; the 'pose' event updates poses[].
        if (poseReady && !detecting) {
            detecting = true;
            poseNet.singlePose(imgEl)
                .then(() => { detecting = false; })
                .catch(() => { detecting = false; });
        }

        push();
        if (MIRROR) { translate(width, 0); scale(-1, 1); }
        scale(sx, sy);
        drawingContext.drawImage(imgEl, 0, 0);   // native size; scale() fits it to the canvas

        for (let p of poses) {
            fill(0, 255, 0);
            noStroke();
            for (let kp of p.pose.keypoints) {
                circle(kp.position.x, kp.position.y, 15/sx);
            }

            noFill();
            stroke(255);
            strokeWeight(3/sx);
            for (let bone of p.skeleton) {
                const a = bone[0].position, b = bone[1].position;
                line(a.x, a.y, b.x, b.y);
            }
        }
        pop();
    } else {
        // Waiting for stream — placeholder message (house cream card).
        fill('#F2E9D8'); noStroke();
        rect(0, 0, width, height);
        fill('#6d6a5f');
        textAlign(CENTER, CENTER); textSize(16);
        const msg = !arduino.connected ? 'Connecting…'
                  : !poseReady          ? 'Loading PoseNet model…'
                  :                       'Starting camera…';
        text(msg, width / 2, height / 2);
        textAlign(LEFT, BASELINE);
    }

    // Connection status dot — top-right corner (teal = connected)
    noStroke();
    fill(arduino.connected ? '#3FA9A0' : '#D3542B');
    circle(width - 16, 16, 12);
}
