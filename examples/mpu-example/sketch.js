// ==============================================================
// MPU-6050 3D Orientation Visualiser
// Pardalote example — p5.js + MPU-6050 extension
//
// Wiring (MPU-6050 → Arduino):
//   VCC → 3.3 V      GND → GND
//   SDA → SDA pin    SCL → SCL pin
//   AD0 → GND        (sets I2C address to 0x68)
//
// Firmware: sketch must `#include <PardaloteMPU.h>` (see examples/mpu in the Pardalote library).
// ==============================================================

// ── Change this to your Arduino's IP address ─────────────────
const ARDUINO_IP = '10.1.1.186';

// ── Tuning ───────────────────────────────────────────────────
const POLL_MS = 50;    // sensor poll interval ms (50 Hz)

// Complementary filter blend factor.
// Higher → trusts gyro more (responsive but drifts over time).
// Lower  → trusts accel more (stable but noisy during motion).
const ALPHA = 0.96;

// ── State ────────────────────────────────────────────────────
let arduino;
let roll  = 0;   // radians — rotation about sensor X axis (left / right tilt)
let pitch = 0;   // radians — rotation about sensor Y axis (forward / back tilt)
let yaw   = 0;   // radians — rotation about sensor Z axis (heading; drifts over time)
let lastT = 0;   // timestamp of the previous reading (ms)

let myModel;

function preload() {
  // Load the 3D model and automatically normalize (scale) it
  // Supported file formats are .obj and .stl
  myModel = loadModel('lowest-poly-benchy-utkdesign.stl', true); 
}

// ── p5 setup ─────────────────────────────────────────────────
function setup() {
    createCanvas(windowWidth, windowHeight, WEBGL);
    pixelDensity(1);  // avoid doubling work on retina displays
    perspective(PI / 4, width / height, 1, 5000);

    arduino = new Arduino();
    arduino.add('imu', new MPU('6050'));

    arduino.on('ready', () => {
        setStatus(true);
        arduino.imu.attach(0x68);     // change to 0x69 if AD0 is HIGH
        arduino.imu.onRead(onRead);
        arduino.imu.onCalibrate(onCalibrate);
        arduino.imu.read(POLL_MS);
    });

    arduino.on('disconnect', () => setStatus(false));
    arduino.on('connect',    () => setStatus(false));  // socket open, not yet ready

    arduino.connect(ARDUINO_IP);
}

// ── Main draw loop ────────────────────────────────────────────
function draw() {
    background(16, 18, 26);

    // Camera — slightly above and to the right for a natural 3D view
    camera(180, -220, 560, 0, 0, 0, 0, 1, 0);

    // Scene lighting
    ambientLight(65);
    directionalLight(210, 220, 235, -0.4, -0.9, -0.5);  // soft top-left key
    pointLight(255, 235, 160, 220, -180, 280);            // warm front-right fill

    // Apply sensor orientation. Aerospace convention: yaw → pitch → roll.
    // Adjust signs here if the board rotates the wrong way on screen:
    //   flip rotateY → rotateY(yaw)
    //   flip rotateX → rotateX(-pitch)
    //   flip rotateZ → rotateZ(roll)
    rotateY(yaw);
    rotateX(-roll);
    rotateZ(pitch);

    drawPlane();

    // Render the loaded model
    translate(0, -65, 0);
    // rotate model to sit upright
    rotateX(PI/2);
    model(myModel);

    drawAxes(200);
}

// ── 3D model ──────────────────────────────────────────────────
function drawPlane() {
    push();
    noStroke();

    // PCB substrate — flat blue surface
    fill(50, 100, 200);
    box(310, 12, 248);

    // Orientation marker — gold sphere at the +X edge of the board.
    // Represents the axis-1 direction printed on the MPU-6050 silkscreen.
    translate(130, -6, 80);
    fill(255, 205, 50);
    sphere(8);

    pop();
}

// Coordinate axes — rotate with the board so you can see tilt direction.
// Red = X   Green = Y   Blue = Z  (sensor convention)
function drawAxes(len) {
    push();
    strokeWeight(2);
    noFill();

    // X axis — along board long edge
    stroke(210, 55, 55);
    line(0, 0, 0, len, 0, 0);

    // Y axis — along board short edge
    // p5.js Y is down, so −Y in model space = up on screen
    stroke(55, 195, 75);
    line(0, 0, 0, 0, -len, 0);

    // Z axis — out of the board top surface
    // Sensor Z points up, which is p5's −Y when the board is flat;
    // we show it going away from the camera (into the scene) to avoid
    // overlapping the Y axis.
    stroke(55, 95, 210);
    line(0, 0, 0, 0, 0, -len);

    pop();
}

// ── Sensor callback ───────────────────────────────────────────
function onRead({ accel, gyro, temp }) {
    const now = millis();
    const dt  = lastT ? (now - lastT) / 1000 : 0;
    lastT = now;

    // Tilt angles from gravity — good long-term reference, noisy during motion.
    const aRoll  = Math.atan2(accel.y, accel.z);
    const aPitch = Math.atan2(-accel.x, Math.sqrt(accel.y ** 2 + accel.z ** 2));

    // Complementary filter:
    //   gyro integration gives fast, accurate response to rotation
    //   accel tilt slowly corrects gyro drift
    //   gyro is in °/s — convert to rad/s before integrating
    const toRad = Math.PI / 180;
    roll  = ALPHA * (roll  + gyro.x * toRad * dt) + (1 - ALPHA) * aRoll;
    pitch = ALPHA * (pitch + gyro.y * toRad * dt) + (1 - ALPHA) * aPitch;
    // Yaw — pure gyro integration. The MPU-6050 has no magnetometer, so
    // there's no gravity-like reference to correct heading drift. Expect a
    // few degrees per minute of drift; press 'c' to recalibrate and zero.
    yaw  += gyro.z * toRad * dt;

    // Update HUD text
    const rollDeg  = degrees(roll);
    const pitchDeg = degrees(pitch);
    // Wrap yaw to ±180° so it doesn't grow unbounded as the gyro integrates.
    const yawDeg   = ((degrees(yaw) % 360) + 540) % 360 - 180;

    id('roll-val').textContent  = fmt(rollDeg);
    id('pitch-val').textContent = fmt(pitchDeg);
    id('yaw-val').textContent   = fmt(yawDeg);
    id('accel').textContent =
        `X ${fmtV(accel.x)}  Y ${fmtV(accel.y)}  Z ${fmtV(accel.z)}`;
    id('gyro').textContent =
        `X ${fmtV(gyro.x, 1)}  Y ${fmtV(gyro.y, 1)}  Z ${fmtV(gyro.z, 1)}`;
    id('temp').textContent =
        `TEMP  ${temp.toFixed(1)} °C`;
}

function onCalibrate() {
    // Reset the filter so stale angles don't persist after calibration.
    // Yaw gets zeroed too — it has no long-term reference, so 'c' is the
    // only way to bring it back to a known heading.
    roll = 0; pitch = 0; yaw = 0; lastT = 0;
    id('cal-msg').textContent = 'Calibration complete';
    setTimeout(() => { id('cal-msg').textContent = ''; }, 3000);
}

// ── UI ────────────────────────────────────────────────────────
function doCalibrate() {
    if (!arduino?.imu?.isAttached) return;
    id('cal-msg').textContent = 'Calibrating… keep sensor flat and still';
    arduino.imu.calibrate(200);  // 200 samples ≈ 400 ms
}

function setStatus(connected) {
    const el = id('status');
    el.textContent = connected ? '● CONNECTED' : '● DISCONNECTED';
    el.className   = connected ? 'connected'   : 'disconnected';
}

function keyPressed() {
    if (key === 'c' || key === 'C') doCalibrate();
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
    perspective(PI / 4, width / height, 1, 5000);
}

// ── Helpers ───────────────────────────────────────────────────
const id = sel => document.getElementById(sel);

// Right-align a 1-decimal number in a fixed-width field (incl. sign space)
function fmt(n, width = 7) {
    return (n >= 0 ? ' ' : '') + n.toFixed(1).padStart(width);
}

// Value with explicit sign and 3 decimal places — for sensor readouts
function fmtV(n, dp = 3) {
    return (n >= 0 ? '+' : '') + n.toFixed(dp);
}
