// ==============================================================
// Servo Control Example
// Drive a PWM servo from the browser and exercise the modern API:
//   • write()        — immediate move
//   • writeTimed()    — on-board interpolation over a duration
//   • whenDone()      — await real arrival (logged with elapsed ms)
//   • setLimits()     — soft limits clamped on the Arduino
//   • setHome()/home()— declare a home angle and glide to it
// House style follows the coordinated-motion example.
// by Scott Mitchell
// GPL-3.0 License
// ==============================================================

let ArduinoIP   = '10.1.1.128';   // Change this to your Arduino's IP
const SERVO_PIN = 18;             // ESP32: any LEDC-capable pin. Give the servo its own 5V supply + common ground.

const W = 520, H = 300, cx = W / 2, cy = 210, R = 120, D = 2 * R;

let arduino;
let ready = false;

// Display interpolation so the gauge animates smoothly whether or not a
// timed move is running. A leg eases `from`→`to` (degrees) over moveDur ms.
let disp = 90, from = 90, to = 90, moveStart = 0, moveDur = 200;

// Soft-limit + home state, mirrored locally just for the on-screen readout.
let limMin = null, limMax = null, homeAngle = 90;

let statusEl, logEl, targetSlider, durSlider, durVal, minInput, maxInput, homeInput;
let logLines = [];

// Brief ring pulse when a whenDone() settles — green = arrived, red = timeout.
let flashUntil = 0, flashOk = true;
const flash = ok => { flashUntil = millis() + 700; flashOk = ok; };

const easeInOut = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function setup() {
    const main = select('main');

    const topBar = createDiv().id('top').parent(main);
    createDiv('Servo — timed moves, limits &amp; home').class('heading').parent(topBar);
    statusEl = createDiv('status: starting…').id('status').parent(topBar);

    // --- Immediate write ---
    const row1 = createDiv().class('row').parent(main);
    createSpan('Write').class('lbl').parent(row1);
    createButton('0°').parent(row1).mousePressed(() => doWrite(0));
    createButton('center 90°').parent(row1).mousePressed(() => doWrite(90));
    createButton('180°').parent(row1).mousePressed(() => doWrite(180));

    // --- Timed move + whenDone ---
    const row2 = createDiv().class('row').parent(main);
    createSpan('Timed').class('lbl').parent(row2);
    createSpan('target').parent(row2);
    targetSlider = createSlider(0, 180, 120, 1).parent(row2);
    createSpan('over').parent(row2);
    durSlider = createSlider(300, 3000, 1500, 100).parent(row2);
    durVal = createSpan('1500 ms').parent(row2);
    durSlider.input(() => durVal.html(durSlider.value() + ' ms'));
    createButton('writeTimed → whenDone').parent(row2).mousePressed(doTimed);

    // --- Soft limits ---
    const row3 = createDiv().class('row').parent(main);
    createSpan('Limits').class('lbl').parent(row3);
    minInput = createInput('20', 'number').parent(row3);
    createSpan('to').parent(row3);
    maxInput = createInput('160', 'number').parent(row3);
    createButton('Set').parent(row3).mousePressed(doSetLimits);
    createButton('Clear').parent(row3).mousePressed(doClearLimits);

    // --- Home ---
    const row4 = createDiv().class('row').parent(main);
    createSpan('Home').class('lbl').parent(row4);
    createButton('Set = here').parent(row4).mousePressed(doSetHomeHere);
    homeInput = createInput('45', 'number').parent(row4);
    createButton('Set = value').parent(row4).mousePressed(doSetHomeValue);
    createButton('Home (snap)').parent(row4).mousePressed(doHomeSnap);
    createButton('Home (1s)').parent(row4).mousePressed(doHome);

    createCanvas(W, H).parent(main);
    logEl = createDiv('').id('log').parent(main);

    arduino = new Arduino();
    arduino.add('myServo', new Servo());
    arduino.on('ready', onReady);
    arduino.on('disconnect', () => { ready = false; setStatus('reconnecting…'); });
    arduino.connect(ArduinoIP);
    setStatus('connecting…');
}

// Attach INSIDE 'ready' (extension state is reset on every (re)connect).
function onReady() {
    arduino.myServo.attach(SERVO_PIN);
    arduino.myServo.center();          // 90°
    snapTo(90);
    homeAngle = 90;
    ready = true;
    setStatus(`ready — servo on pin ${SERVO_PIN}`);
    log('connected, attached, centered');
}

// -------------------------------------------------------------------
// Commands. After each call we read arduino.myServo.angle — the value the library
// actually applied (already clamped to any soft limits) — and drive the
// gauge to that, so a clamp is visible on screen.
// -------------------------------------------------------------------
function doWrite(a) {
    if (!ready) return;
    arduino.myServo.write(a);
    startLeg(arduino.myServo.angle, 200);
    log(`write(${a})${clampNote(a, arduino.myServo.angle)}`);
}

async function doTimed() {
    if (!ready) return;
    const target = targetSlider.value();
    const dur    = durSlider.value();
    const move   = arduino.myServo.writeTimed(target, dur);
    startLeg(arduino.myServo.angle, dur);
    log(`writeTimed(${target}, ${dur} ms)${clampNote(target, arduino.myServo.angle)} …`);
    const t0 = millis();
    const ok = await move.whenDone();
    flash(ok);
    log(`  ↳ whenDone → ${ok ? 'arrived' : 'TIMEOUT'} in ${round(millis() - t0)} ms`);
}

function doSetLimits() {
    if (!ready) return;
    const mn = int(minInput.value()), mx = int(maxInput.value());
    arduino.myServo.setLimits(mn, mx);
    limMin = mn; limMax = mx;
    log(`setLimits(${mn}, ${mx})`);
}

function doClearLimits() {
    if (!ready) return;
    arduino.myServo.clearLimits();
    limMin = limMax = null;
    log('clearLimits()');
}

function doSetHomeHere() {
    if (!ready) return;
    arduino.myServo.setHome();               // no-arg = "here is home"
    homeAngle = round(disp);
    log(`setHome() → ${homeAngle}°`);
}

function doSetHomeValue() {
    if (!ready) return;
    const v = int(homeInput.value());
    arduino.myServo.setHome(v);
    homeAngle = v;
    log(`setHome(${v})`);
}

function doHomeSnap() {
    if (!ready) return;
    arduino.myServo.home();                // no-arg = snap straight to home
    startLeg(arduino.myServo.angle, 150);
    log(`home() → ${homeAngle}° (snap)`);
}

async function doHome() {
    if (!ready) return;
    const move = arduino.myServo.home(1000);
    startLeg(arduino.myServo.angle, 1000);
    log(`home(1000) → ${homeAngle}° …`);
    const ok = await move.whenDone();
    flash(ok);
    log(`  ↳ whenDone → ${ok ? 'arrived' : 'TIMEOUT'}`);
}

// -------------------------------------------------------------------
// Display helpers
// -------------------------------------------------------------------
function startLeg(target, dur) {
    from = disp; to = target; moveStart = millis(); moveDur = max(dur, 1);
}
function snapTo(a) { disp = from = to = a; moveStart = millis(); moveDur = 1; }

function clampNote(requested, applied) {
    return round(requested) !== round(applied) ? ` (clamped → ${round(applied)}°)` : '';
}

function setStatus(s) { if (statusEl) statusEl.html('status: ' + s); }

function log(m) {
    logLines.unshift(m);
    logLines = logLines.slice(0, 8);
    if (logEl) logEl.html(logLines.map(l => `<div>${l}</div>`).join(''));
}

// 0° → left (PI), 90° → up (1.5PI), 180° → right (TWO_PI)
const angleFor = deg => PI + (constrain(deg, 0, 180) / 180) * PI;

function draw() {
    background(28);

    const t = moveDur > 0 ? constrain((millis() - moveStart) / moveDur, 0, 1) : 1;
    disp = lerp(from, to, easeInOut(t));

    push();
    translate(cx, cy);

    // gauge track (top semicircle)
    noFill();
    stroke(70); strokeWeight(3);
    arc(0, 0, D, D, PI, TWO_PI);

    // allowed band when limits are set
    if (limMin !== null) {
        stroke(90, 200, 120); strokeWeight(3);
        arc(0, 0, D, D, angleFor(limMin), angleFor(limMax));
    }

    // home tick
    const ha = angleFor(homeAngle);
    stroke(240, 210, 90); strokeWeight(2);
    line(cos(ha) * (R - 12), sin(ha) * (R - 12), cos(ha) * (R + 8), sin(ha) * (R + 8));

    // arm
    const a = angleFor(disp);
    stroke(120, 200, 255); strokeWeight(6);
    line(0, 0, cos(a) * R, sin(a) * R);
    fill(255); noStroke(); circle(0, 0, 12);

    // whenDone pulse: a ring that expands and fades (green = arrived, red = timeout)
    if (millis() < flashUntil) {
        const f = (flashUntil - millis()) / 700;          // 1 → 0
        noFill(); strokeWeight(4);
        if (flashOk) stroke(90, 220, 130, 255 * f);
        else         stroke(230, 90, 90, 255 * f);
        circle(0, 0, D + 26 * (1 - f));
    }

    // readouts
    textAlign(CENTER);
    fill(255); textSize(20);
    text(`${round(disp)}°`, 0, 42);
    fill(150); textSize(12);
    text(limMin === null ? 'limits: none' : `limits: ${limMin}–${limMax}°`, 0, 62);
    fill(240, 210, 90);
    text(`home: ${homeAngle}°`, 0, 80);
    textAlign(LEFT);
    pop();
}
