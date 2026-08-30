// ==============================================================
// MPU-6050 3D Orientation Visualiser
// Pardalote example — p5.js + MPU-6050 extension
//
// Wiring (MPU-6050 → Arduino):
//   VCC → 3.3 V      GND → GND
//   SDA → SDA pin    SCL → SCL pin
//   AD0 → GND        (I²C address 0x68; tie AD0 → 3V3 for 0x69)
//
// Connection and the I²C address are set on the page (and remembered by this
// browser) — no code editing needed. Arduino firmware must
// `#include <PardaloteIMU.h>` (see examples/imu in the Pardalote library).
// House style: see style.css — shared by every Pardalote example.
// ==============================================================

// ── Tuning ───────────────────────────────────────────────────
const POLL_MS = 50;    // sensor poll interval ms (50 Hz)
// Filter blend factor. Higher → trusts gyro more (responsive but drifts);
// lower → trusts accel more (stable but noisy during motion).
const ALPHA = 0.96;

const W = 760, H = 460;   // 3D view size

// ── Saved settings (browser localStorage) ────────────────────
// sda/scl are the ESP32 I²C pins (software-definable there via Wire.begin);
// UNO R4 uses its fixed hardware SDA/SCL and ignores them.
const STORE = 'pardalote-imu';
const saved = { ip: '192.168.x.x', transport: 'wifi', addr: '0x68', sda: 21, scl: 22, ...(JSON.parse(localStorage.getItem(STORE) || '{}')) };

// ── State ────────────────────────────────────────────────────
let arduino, ready = false, manualDisconnect = false, usbBusy = false;
let roll = 0, pitch = 0, yaw = 0;   // radians
let lastT = 0;                      // timestamp of previous reading (ms)
let myModel;

// DOM handles for the connection + wiring rows
let ipEl, transportEl, connectEl, disconnectEl, addrEl, sdaEl, sclEl;

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

    // connection + wiring rows (index.html) — wire up the standard controls
    ipEl = id('ip'); transportEl = id('transport');
    connectEl = id('connect'); disconnectEl = id('disconnect');
    addrEl = id('addr'); sdaEl = id('sda'); sclEl = id('scl');
    ipEl.value = saved.ip;
    transportEl.value = (saved.transport === 'usb') ? 'USB' : 'WiFi';
    addrEl.value = saved.addr; sdaEl.value = saved.sda; sclEl.value = saved.scl;
    transportEl.onchange = switchTransport;
    connectEl.onclick = doConnect;
    disconnectEl.onclick = doDisconnect;
    const applyWiring = () => { persistConn(); if (ready) applyImu(); };
    addrEl.onchange = applyWiring; sdaEl.onchange = applyWiring; sclEl.onchange = applyWiring;
    applyTransport();

    arduino = new Arduino();
    arduino.add('imu', new IMU('6050'));
    arduino.on('ready', () => { setConnected(true); applyImu(); });
    arduino.on('disconnect', () => {
        ready = false; setConnected(false);
        if (usbBusy) { usbBusy = false; setStatus('board is on WiFi — press Connect to switch it to USB'); }
        else if (!manualDisconnect) setStatus('reconnecting…');
    });
    arduino.on('usbBusy', () => { usbBusy = true; });

    // Returning visit: reconnect with the remembered settings.
    if (localStorage.getItem(STORE)) doConnect();
    else setStatus("enter your board's IP and press Connect");
}

// Attach the IMU INSIDE 'ready' (device state resets on every reconnect).
function applyImu() {
    const addr = Number(saved.addr) || 0x68;   // Number('0x68') → 104
    const sda = parseInt(saved.sda, 10), scl = parseInt(saved.scl, 10);
    // SDA/SCL are honoured on ESP32 (Wire.begin(sda, scl)); UNO R4 ignores them.
    arduino.imu.attach(addr, Number.isFinite(sda) ? sda : -1, Number.isFinite(scl) ? scl : -1);
    arduino.imu.onChange(onReading);
    arduino.imu.onCalibrate(onCalibrate);
    arduino.imu.read(POLL_MS);
    ready = true;
    applyBoardLock();
    setStatus(`ready — MPU-6050 at 0x${addr.toString(16)}`);
}

// On a UNO R4 the I²C pins are fixed hardware — lock the SDA/SCL fields (as the
// bus tools lock RX/TX). ESP32 keeps them editable (software-defined pins).
function applyBoardLock() {
    const isR4 = String(arduino.board || '').includes('UNO R4');
    lockField(sdaEl, isR4); lockField(sclEl, isR4);
}
function lockField(el, lock) {
    el.disabled = lock;
    el.style.color = lock ? '#a49f92' : '';
    el.style.background = lock ? '#efece4' : '';
    el.style.cursor = lock ? 'not-allowed' : '';
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

// -------------------------------------------------------------------
// Connection standard (see PROJECT-STATUS; duplicated per example)
// -------------------------------------------------------------------
function persistConn() {
    saved.ip = ipEl.value.trim();
    saved.transport = (transportEl.value === 'USB') ? 'usb' : 'wifi';
    saved.addr = addrEl.value.trim();
    saved.sda = parseInt(sdaEl.value, 10);
    saved.scl = parseInt(sclEl.value, 10);
    localStorage.setItem(STORE, JSON.stringify(saved));
}
function applyTransport() {
    const usb = (transportEl.value === 'USB');
    ipEl.style.display = usb ? 'none' : '';
}
function setConnected(on) {
    connectEl.textContent = on ? 'Connected' : 'Connect';
    connectEl.classList.toggle('connected', on);
    connectEl.classList.toggle('primary', !on);
    if (!on) { disconnectEl.textContent = 'Disconnect'; disconnectEl.disabled = false; }
}
function switchTransport() {
    manualDisconnect = true; ready = false;
    arduino.disconnect();
    setConnected(false);
    persistConn();
    applyTransport();
    setStatus('channel switched — press Connect');
}
async function doConnect() {
    persistConn();
    manualDisconnect = false; ready = false;
    if (saved.transport === 'usb') {
        setStatus('connecting over USB…');
        await arduino.connectSerial(PROMPT);   // always show the port picker
        if (!arduino.socket) setStatus('press Connect and choose the USB port');
        return;
    }
    const ip = ipEl.value.trim();
    if (!ip || ip.includes('x')) { setStatus("enter your board's IP and press Connect"); return; }
    arduino.connect(ip);
    setStatus('connecting…');
}
function doDisconnect() {
    manualDisconnect = true; ready = false;
    disconnectEl.textContent = 'Disconnecting…'; disconnectEl.disabled = true;
    connectEl.textContent = 'Connect'; connectEl.classList.remove('connected'); connectEl.classList.add('primary');
    arduino.disconnect();
    setTimeout(() => setConnected(false), 3000);
    setStatus('disconnected — press Connect to resume');
}

// ── Helpers ───────────────────────────────────────────────────
const id = sel => document.getElementById(sel);
function setStatus(s) { id('status').textContent = 'status: ' + s; }

// Right-align a 1-decimal number in a fixed-width field (incl. sign space)
function fmt(n, width = 7) {
    return (n >= 0 ? ' ' : '') + n.toFixed(1).padStart(width);
}
// Value with explicit sign and 3 decimal places — for sensor readouts
function fmtV(n, dp = 3) {
    return (n >= 0 ? '+' : '') + n.toFixed(dp);
}
