// ==============================================================
// MPU-6050 3D Orientation Visualiser
// Pardalote example — p5.js + MPU-6050 extension
//
// Wiring (MPU-6050 → Arduino):
//   VCC → 3.3 V      GND → GND
//   SDA → SDA pin    SCL → SCL pin
//   AD0 → GND        (I²C address 0x68; tie AD0 → 3V3 for 0x69)
//
// The on-page Board controls (WiFi / USB, remembered IP, Connect) live in
// connect.js — this file is just the lesson. Arduino firmware must
// `#include <PardaloteIMU.h>` (see examples/imu in the Pardalote library).
// ==============================================================

// ── Sensor settings ──────────────────────────────────────────
const ADDR = 0x68;     // I²C address (0x69 if AD0 → 3V3)
// SDA/SCL are the ESP32 I²C pins (software-definable via Wire.begin). A UNO R4
// uses its fixed hardware SDA/SCL and ignores these.
const SDA = 21;
const SCL = 22;

const POLL_MS = 50;    // sensor poll interval ms (50 Hz)
// Filter blend factor. Higher → trusts gyro more (responsive but drifts);
// lower → trusts accel more (stable but noisy during motion).
const ALPHA = 0.96;

const W = 760, H = 460;   // 3D view size

// ── State ────────────────────────────────────────────────────
let arduino;
let roll = 0, pitch = 0, yaw = 0;   // radians
let lastT = 0;                      // timestamp of previous reading (ms)
let myModel;

function preload() {
    // Load the 3D model and normalize (scale) it. .obj and .stl are supported.
    myModel = loadModel('lowest-poly-benchy-utkdesign.stl', true);
}

// ── p5 setup ─────────────────────────────────────────────────
function setup() {
    const cnv = createCanvas(W, H, WEBGL);
    cnv.parent('stage');
    pixelDensity(1);
    perspective(PI / 4, W / H, 1, 5000);

    arduino = new Arduino();
    arduino.add('imu', new IMU('6050'));
    setupConnection(arduino, { store: 'pardalote-imu' });

    // Attach the IMU once the board is ready (device state resets on reconnect).
    arduino.on('ready', () => {
        arduino.imu.attach(ADDR, SDA, SCL);   // I²C address, then ESP32 SDA/SCL (UNO R4 ignores these)
        arduino.imu.onChange(onReading);
        arduino.imu.onCalibrate(onCalibrate);
        arduino.imu.read(POLL_MS);
    });
}

// ── Main draw loop ────────────────────────────────────────────
function draw() {
    background(255);   // house paper

    // Camera — slightly above and to the right for a natural 3D view
    camera(180, -220, 560, 0, 0, 0, 0, 1, 0);

    // Scene lighting — brighter ambient for the white background
    ambientLight(120);
    directionalLight(190, 190, 185, -0.4, -0.9, -0.5);
    pointLight(240, 225, 190, 220, -180, 280);

    // Apply sensor orientation (aerospace convention: yaw → pitch → roll).
    rotateY(yaw);
    rotateX(-roll);
    rotateZ(pitch);

    drawPlane();

    // Render the loaded model
    translate(0, -65, 0);
    rotateX(PI / 2);
    noStroke();
    fill('#30bf30');
    model(myModel);

    drawAxes(200);
}

// ── 3D model ──────────────────────────────────────────────────
function drawPlane() {
    push();
    noStroke();
    fill('#5864e7');
    box(310, 12, 248);
    // Orientation marker — sphere at the +X edge (axis-1 on the silkscreen)
    translate(130, -6, 80);
    fill('#e8433d');
    sphere(8);
    pop();
}

// Coordinate axes — orange = X, teal = Y, amber = Z (match the HUD labels)
function drawAxes(len) {
    push();
    strokeWeight(2);
    noFill();
    stroke('#D3542B'); line(0, 0, 0, len, 0, 0);      // X — board long edge
    stroke('#3FA9A0'); line(0, 0, 0, 0, -len, 0);      // Y — board short edge (−Y is up)
    stroke('#E8A33D'); line(0, 0, 0, 0, 0, -len);      // Z — out of the board top
    pop();
}

// ── Sensor callback ───────────────────────────────────────────
function onReading({ accel, gyro, temp }) {
    const now = millis();
    const dt  = lastT ? (now - lastT) / 1000 : 0;
    lastT = now;

    // Tilt from gravity — good long-term reference, noisy during motion.
    const aRoll  = Math.atan2(accel.y, accel.z);
    const aPitch = Math.atan2(-accel.x, Math.sqrt(accel.y ** 2 + accel.z ** 2));

    // Complementary filter: gyro integration + slow accel correction.
    const toRad = Math.PI / 180;
    roll  = ALPHA * (roll  + gyro.x * toRad * dt) + (1 - ALPHA) * aRoll;
    pitch = ALPHA * (pitch + gyro.y * toRad * dt) + (1 - ALPHA) * aPitch;
    // Yaw — pure gyro integration (no magnetometer, so it drifts; press 'c' to zero).
    yaw  += gyro.z * toRad * dt;

    const rollDeg  = degrees(roll);
    const pitchDeg = degrees(pitch);
    const yawDeg   = ((degrees(yaw) % 360) + 540) % 360 - 180;   // wrap ±180°

    id('roll-val').textContent  = fmt(rollDeg);
    id('pitch-val').textContent = fmt(pitchDeg);
    id('yaw-val').textContent   = fmt(yawDeg);
    id('accel').textContent = `X ${fmtV(accel.x)} Y ${fmtV(accel.y)} Z ${fmtV(accel.z)}`;
    id('gyro').textContent  = `X ${fmtV(gyro.x, 1)} Y ${fmtV(gyro.y, 1)} Z ${fmtV(gyro.z, 1)}`;
    id('temp').textContent  = `TEMP  ${temp.toFixed(1)} °C`;
}

function onCalibrate() {
    // Reset the filter so stale angles don't persist; yaw zeroes too.
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

function keyPressed() {
    if (key === 'c' || key === 'C') doCalibrate();
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
