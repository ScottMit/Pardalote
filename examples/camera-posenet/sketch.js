// ==============================================================
// Camera Pose — p5.js + Pardalote
// Runs Google MediaPipe Pose Landmarker on the MJPEG video streamed from an
// ESP32 camera, instead of a local webcam (createCapture). There's no pin to
// set — the camera's stream port is fixed by the firmware.
//
// The only real difference vs. a webcam: the video arrives as a cross-origin
// MJPEG <img>. MediaPipe has to READ pixels from it, so the <img> is loaded with
// crossOrigin='anonymous' — which works because PardaloteCamera.h serves
// Access-Control-Allow-Origin: *. The stream is HTTP-direct to the board's IP,
// so pose video needs a WiFi connection.
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
// (Not called MIRROR — p5 already defines a MIRROR constant.)
const MIRROR_VIDEO = true;

// Pose model: 'lite' (fastest), 'full', or 'heavy' (most accurate, slowest).
const POSE_MODEL = 'lite';

// How many people to track at once.
const NUM_POSES = 1;

// Detections per second. Pose detection runs on the page's main thread, so
// capping it leaves time for drawing and for the Pardalote connection. The
// MJPEG stream rarely beats ~20 fps anyway.
const DETECT_FPS = 15;

// Each landmark carries a visibility score (0–1): how likely it is to be in
// frame and not hidden. Only landmarks (and bones) at least this visible are drawn.
const MIN_VISIBILITY = 0.5;

// MediaPipe Tasks Vision — pinned so a new release can't break the example.
const MP_VERSION = '0.10.14';
const MP_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MODEL_URL = `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${POSE_MODEL}/float16/1/pose_landmarker_${POSE_MODEL}.task`;

let arduino;
let imgEl = null;                 // raw <img> holding the live MJPEG stream

// --- MediaPipe Pose Landmarker ------------------------------------------
let poseLandmarker = null;
let poseConnections = [];         // [{ start, end }] landmark index pairs
let modelError = null;
let lastDetect = 0;
let poses = [];                   // one array of 33 landmarks per person

function setup() {
    createCanvas(640, 480);

    // Load the model up front so it's warm by the time video arrives.
    loadPoseModel();

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

// import() works from a normal (non-module) script, so p5 global mode is kept.
async function loadPoseModel() {
    try {
        const { PoseLandmarker, FilesetResolver } = await import(MP_URL);
        const vision = await FilesetResolver.forVisionTasks(`${MP_URL}/wasm`);
        const options = (delegate) => ({
            baseOptions: { modelAssetPath: MODEL_URL, delegate },
            runningMode: 'VIDEO',      // track frame to frame — smoother than per-image
            numPoses: NUM_POSES,
        });
        try {
            poseLandmarker = await PoseLandmarker.createFromOptions(vision, options('GPU'));
        } catch (err) {
            console.warn('MediaPipe GPU delegate failed, falling back to CPU:', err);
            poseLandmarker = await PoseLandmarker.createFromOptions(vision, options('CPU'));
        }
        // Warm up on a blank frame. The very first detection sets up the GPU and
        // can freeze the page for several seconds — do it now, before the board
        // is connected, rather than on the first video frame (where the freeze
        // could look like a dead connection).
        const blank = document.createElement('canvas');
        blank.width = 64; blank.height = 48;
        poseLandmarker.detectForVideo(blank, performance.now());
        poseConnections = PoseLandmarker.POSE_CONNECTIONS;
    } catch (err) {
        console.error('Could not load MediaPipe Pose Landmarker:', err);
        modelError = err;
    }
}

// Build a fresh cross-origin <img> for the MJPEG stream. crossOrigin MUST be
// set BEFORE src, or the browser fetches without CORS and MediaPipe's pixel
// read throws a tainted-canvas SecurityError.
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

// Run the model on the current stream frame, at most DETECT_FPS times a second.
// detectForVideo() is synchronous — results are ready as soon as it returns.
function detectPoses() {
    const now = performance.now();
    if (!poseLandmarker || now - lastDetect < 1000 / DETECT_FPS) return;
    lastDetect = now;
    try {
        poses = poseLandmarker.detectForVideo(imgEl, now).landmarks;
    } catch (err) {
        // e.g. a frame that hasn't finished decoding — just try again next time
        console.warn('Pose detection failed:', err);
    }
}

function draw() {
    background(0);

    if (imgEl && imgEl.naturalWidth > 0) {
        detectPoses();

        push();
        if (MIRROR_VIDEO) { translate(width, 0); scale(-1, 1); }
        drawingContext.drawImage(imgEl, 0, 0, width, height);   // stretch the frame to the canvas

        // Landmarks are 0–1 across the frame, so × width / height puts them on the canvas.
        for (let landmarks of poses) {
            noFill();
            stroke(255);
            strokeWeight(3);
            for (let { start, end } of poseConnections) {
                const a = landmarks[start], b = landmarks[end];
                // skip a bone unless both ends are visible, so it can't anchor to a jittery point
                if (a.visibility < MIN_VISIBILITY || b.visibility < MIN_VISIBILITY) continue;
                line(a.x * width, a.y * height, b.x * width, b.y * height);
            }

            fill(0, 255, 0);
            noStroke();
            for (let lm of landmarks) {
                if (lm.visibility < MIN_VISIBILITY) continue;
                circle(lm.x * width, lm.y * height, 10);
            }
        }
        pop();
    } else {
        // Waiting for stream — placeholder message (house cream card).
        fill('#F2E9D8'); noStroke();
        rect(0, 0, width, height);
        fill('#6d6a5f');
        textAlign(CENTER, CENTER); textSize(16);
        const msg = modelError         ? 'Pose model failed to load — see the browser console'
                  : !arduino.connected ? 'Connecting…'
                  : !poseLandmarker    ? 'Loading pose model…'
                  :                      'Starting camera…';
        text(msg, width / 2, height / 2);
        textAlign(LEFT, BASELINE);
    }

    // Connection status dot — top-right corner (teal = connected)
    noStroke();
    fill(arduino.connected ? '#3FA9A0' : '#D3542B');
    circle(width - 16, 16, 12);
}
