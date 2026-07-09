// ==============================================================
// Stepper Control Example
// Full button panel exercising the modern stepper API:
//   • moveTo / move / moveTo 0        — accel-limited position moves
//   • moveToTimed + whenDone          — arrive in ~duration; awaited
//   • runSpeed / stop / hardStop      — spin, smooth decel, instant halt
//   • enable / disable                — hold vs free the coils
//   • setLimits / clearLimits         — soft position limits
//   • setLimitSwitch + 'limit' event  — hardware end-stops
//   • setSwitchPosition               — where a switch sits vs. home
//   • setHome / home + 'homeFail'     — re-zero + seek-switch homing routine
// House style follows the servo / coordinated-motion examples.
// by Scott Mitchell
// GPL-3.0 License
// ==============================================================

let ArduinoIP = '10.1.1.128';   // Change this to your Arduino's IP

// --- Driver wiring: use ONE block for your motor ----------------------
// 'driver' = STEP/DIR (TMC2208/2209, A4988, EasyDriver)
// '4wire'  = 4 coil pins (28BYJ-48 via ULN2003, or bipolar via H-bridge /
//            dual-driver shield). Pin order matches AccelStepper FULL4WIRE.
const MODE        = 'driver';        // 'driver' | '4wire'
const DRIVER_PINS = [12, 14, 27];    // STEP, DIR, EN  (EN optional; -1 = none)
const WIRE4_PINS  = [12, 14, 27, 26];

const MAX_SPEED     = 800;   // steps/sec  (4-wire tops out ~300)
const ACCEL         = 800;   // steps/sec^2 — also governs stop() decel distance
const STEPS_PER_REV = 20;   // affects the dial's rev readout only

const W = 560, H = 380, cx = W / 2, cy = H / 2 - 6, R = 120;

// The stepper is registered with Pardalote and addressed as arduino.myStepper
// throughout — no separate handle to keep in sync.
let arduino, ready = false;
let statusEl, logEl, logLines = [];

// controls
let moveTarget, timedTarget, durSlider, durVal, speedSlider, speedVal,
    msIn, accIn, softMin, softMax, minPin, minTrig, maxPin, maxTrig,
    minPos, maxPos, homeVal, homeSpeed, homeTimeout;

// display
let dispPos = 0;
let flashUntil = 0, flashOk = true;      // whenDone pulse
let limitUntil = 0, limitWhich = '';     // limit-switch trip pulse
let homing = false;

// toggle state + button refs (for highlight)
let enabled = true, minSwSet = false, maxSwSet = false;
let enableBtn, disableBtn, minSetBtn, maxSetBtn;

function setup() {
    const main = select('main');

    const top = createDiv().id('top').parent(main);
    createDiv('Stepper — full control panel').class('heading').parent(top);
    statusEl = createDiv('status: starting…').id('status').parent(top);

    // Move (position)
    let r = row(main, 'Move');
    btn(r, '−¼ turn', () => jog(-1));
    btn(r, '+¼ turn', () => jog(+1));
    moveTarget = num(r, 0, 72);
    btn(r, 'moveTo', () => { if (rdy()) { arduino.myStepper.moveTo(int(moveTarget.value())); log(`moveTo(${int(moveTarget.value())})`); } });
    btn(r, '→ 0', () => { if (rdy()) { arduino.myStepper.moveTo(0); log('moveTo(0)'); } });

    // Timed move + whenDone
    r = row(main, 'Timed');
    createSpan('target').parent(r); timedTarget = num(r, 2000, 72);
    createSpan('over').parent(r);
    durSlider = createSlider(300, 4000, 1500, 100).parent(r);
    durVal = createSpan('1500 ms').parent(r);
    durSlider.input(() => durVal.html(durSlider.value() + ' ms'));
    btn(r, 'moveToTimed → whenDone', doTimed);

    // Spin (velocity)
    r = row(main, 'Spin');
    speedSlider = createSlider(-MAX_SPEED, MAX_SPEED, 400, 10).parent(r);
    speedVal = createSpan('400').parent(r);
    speedSlider.input(() => speedVal.html(String(speedSlider.value())));
    btn(r, 'runSpeed', () => { if (rdy()) { arduino.myStepper.runSpeed(speedSlider.value()); log(`runSpeed(${speedSlider.value()})`); } });
    btn(r, 'stop (decel)', () => { if (rdy()) { arduino.myStepper.stop(); log('stop() — decel ramp'); } });
    btn(r, 'hard stop', () => { if (rdy()) { arduino.myStepper.hardStop(); log('hardStop() — instant'); } });

    // Torque
    r = row(main, 'Torque');
    enableBtn  = btn(r, 'enable (hold)',  () => { if (rdy()) { arduino.myStepper.enable();  enabled = true;  refreshToggles(); log('enable()'); } });
    disableBtn = btn(r, 'disable (free)', () => { if (rdy()) { arduino.myStepper.disable(); enabled = false; refreshToggles(); log('disable() — coils free'); } });

    // Profile
    r = row(main, 'Profile');
    createSpan('maxSpeed').parent(r); msIn = num(r, MAX_SPEED, 72);
    createSpan('accel').parent(r); accIn = num(r, ACCEL, 72);
    btn(r, 'apply', () => { if (rdy()) { arduino.myStepper.setMaxSpeed(int(msIn.value())); arduino.myStepper.setAcceleration(int(accIn.value())); log(`setMaxSpeed(${int(msIn.value())}) setAcceleration(${int(accIn.value())})`); } });

    // Zero + soft limits
    r = row(main, 'Limits');
    btn(r, 'setPosition 0', () => { if (rdy()) { arduino.myStepper.setPosition(0); dispPos = 0; log('setPosition(0)'); } });
    createSpan('soft').parent(r); softMin = num(r, -3200); createSpan('to').parent(r); softMax = num(r, 3200);
    btn(r, 'set', () => { if (rdy()) { arduino.myStepper.setLimits(int(softMin.value()), int(softMax.value())); log(`setLimits(${int(softMin.value())}, ${int(softMax.value())})`); } });
    btn(r, 'clear', () => { if (rdy()) { arduino.myStepper.clearLimits(); log('clearLimits()'); } });

    // Limit switch — MIN (pin + trigger, then the coordinate it sits at)
    r = row(main, 'Sw MIN');
    createSpan('pin').parent(r); minPin = num(r, 32);
    minTrig = trigSelect(r);
    minSetBtn = btn(r, 'set', () => setSwitch(LIMIT_MIN, minPin, minTrig, 'MIN'));
    btn(r, 'clear', () => { if (rdy()) { arduino.myStepper.clearLimitSwitch(LIMIT_MIN); minSwSet = false; refreshToggles(); log('clearLimitSwitch(MIN)'); } });
    createSpan('pos').parent(r); minPos = num(r, -500);
    btn(r, 'set pos', () => { if (rdy()) { arduino.myStepper.setSwitchPosition(LIMIT_MIN, int(minPos.value())); log(`setSwitchPosition(MIN, ${int(minPos.value())})`); } });

    // Limit switch — MAX
    r = row(main, 'Sw MAX');
    createSpan('pin').parent(r); maxPin = num(r, 33);
    maxTrig = trigSelect(r);
    maxSetBtn = btn(r, 'set', () => setSwitch(LIMIT_MAX, maxPin, maxTrig, 'MAX'));
    btn(r, 'clear', () => { if (rdy()) { arduino.myStepper.clearLimitSwitch(LIMIT_MAX); maxSwSet = false; refreshToggles(); log('clearLimitSwitch(MAX)'); } });
    createSpan('pos').parent(r); maxPos = num(r, 3200);
    btn(r, 'set pos', () => { if (rdy()) { arduino.myStepper.setSwitchPosition(LIMIT_MAX, int(maxPos.value())); log(`setSwitchPosition(MAX, ${int(maxPos.value())})`); } });

    // Home — home is the origin (0). setHome() re-zeros the frame: the current
    // position becomes 0 and the soft limits + switch positions shift with it.
    r = row(main, 'Home');
    btn(r, 'setHome (here → 0)', () => { if (rdy()) { arduino.myStepper.setHome(); log('setHome() — re-zero: here becomes 0'); } });
    createSpan('or →coord').parent(r); homeVal = num(r, 0);
    btn(r, 'setHome(coord)', () => { if (rdy()) { arduino.myStepper.setHome(int(homeVal.value())); log(`setHome(${int(homeVal.value())}) — here becomes ${int(homeVal.value())}`); } });
    createSpan('speed').parent(r); homeSpeed = num(r, 0);
    createSpan('t/out').parent(r); homeTimeout = num(r, 0);
    btn(r, 'home()', doHome);

    createCanvas(W, H).parent(main);
    logEl = createDiv('').id('log').parent(main);

    arduino = new Arduino();
    arduino.add('myStepper', new Stepper());
    arduino.on('ready', onReady);
    arduino.on('disconnect', () => { ready = false; setStatus('reconnecting…'); });
    arduino.connect(ArduinoIP);
    setStatus('connecting…');
}

function onReady() {
    if (MODE === '4wire') arduino.myStepper.attach4wire(...WIRE4_PINS);
    else                  arduino.myStepper.attach(...DRIVER_PINS);
    arduino.myStepper.setMaxSpeed(MAX_SPEED);
    arduino.myStepper.setAcceleration(ACCEL);
    arduino.myStepper.setStepsPerRev(STEPS_PER_REV);
    arduino.myStepper.setPosition(0);
    arduino.myStepper.read(100);                       // poll live position

    arduino.myStepper.on('limit', ({ which, position }) => {
        limitUntil = millis() + 900; limitWhich = which;
        log(`⚠ limit ${which} @ ${position}`);
    });
    arduino.myStepper.on('homeFail', ({ position }) => log(`⚠ homeFail @ ${position}`));

    dispPos = 0; ready = true;
    enabled = true; minSwSet = false; maxSwSet = false; refreshToggles();
    setStatus(`ready — ${MODE} on ${MODE === '4wire' ? WIRE4_PINS : DRIVER_PINS}`);
    log('connected, attached, zeroed');
}

// -------------------------------------------------------------------
// Commands with awaited feedback
// -------------------------------------------------------------------
function jog(dir) {
    if (!rdy()) return;
    const d = dir * Math.round(arduino.myStepper.stepsPerRev / 4);
    arduino.myStepper.move(d); log(`move(${d})`);
}

async function doTimed() {
    if (!rdy()) return;
    const t = int(timedTarget.value()), dur = durSlider.value();
    const mv = arduino.myStepper.moveToTimed(t, dur);
    log(`moveToTimed(${t}, ${dur} ms) …`);
    const ok = await mv.whenDone();
    flash(ok); log(`  ↳ whenDone → ${ok ? 'arrived' : 'TIMEOUT'}`);
}

function setSwitch(which, pinIn, trigSel, name) {
    if (!rdy()) return;
    const pin = int(pinIn.value());
    const trig = trigSel.value() === 'HIGH' ? HIGH : LOW;
    arduino.myStepper.setLimitSwitch(which, pin, trig);
    if (which === LIMIT_MIN) minSwSet = true; else maxSwSet = true;
    refreshToggles();
    log(`setLimitSwitch(${name}, pin ${pin}, ${trigSel.value()})`);
}

async function doHome() {
    if (!rdy()) return;
    const opts = {};
    if (int(homeSpeed.value()) > 0)   opts.speed   = int(homeSpeed.value());
    if (int(homeTimeout.value()) > 0) opts.timeout = int(homeTimeout.value());
    homing = true; setStatus('homing…');
    log(`home(${JSON.stringify(opts)}) …`);
    const ok = await arduino.myStepper.home(opts).whenDone({ timeout: 35000 });
    homing = false; setStatus('ready'); flash(ok);
    log(`  ↳ home whenDone → ${ok ? 'done' : 'TIMEOUT'}`);
}

// -------------------------------------------------------------------
// UI helpers
// -------------------------------------------------------------------
function row(parent, label) {
    const r = createDiv().class('row').parent(parent);
    createSpan(label).class('lbl').parent(r);
    return r;
}
function btn(parent, label, fn) { return createButton(label).parent(parent).mousePressed(fn); }
function num(parent, val, w) { const i = createInput(String(val), 'number').parent(parent); if (w) i.style('width', w + 'px'); return i; }
function trigSelect(parent) { const s = createSelect().parent(parent); s.option('LOW'); s.option('HIGH'); return s; }
function rdy() { return ready; }

// Highlight the active toggle state: enable/disable pair, and each switch's set.
function refreshToggles() {
    setActive(enableBtn,  enabled,  false);
    setActive(disableBtn, !enabled, true);
    setActive(minSetBtn,  minSwSet, false);
    setActive(maxSetBtn,  maxSwSet, false);
}
function setActive(el, on, warn) {
    if (!el) return;
    el.removeClass('active'); el.removeClass('active-warn');
    if (on) el.addClass(warn ? 'active-warn' : 'active');
}

function flash(ok) { flashUntil = millis() + 700; flashOk = ok; }
function setStatus(s) { if (statusEl) statusEl.html('status: ' + s); }
function log(m) {
    logLines.unshift(m); logLines = logLines.slice(0, 9);
    if (logEl) logEl.html(logLines.map(l => `<div>${l}</div>`).join(''));
}

// -------------------------------------------------------------------
// Dial — full 360°, position → angle (0 at top, clockwise)
// -------------------------------------------------------------------
const angleFor = pos => (pos / (arduino && arduino.myStepper ? arduino.myStepper.stepsPerRev : STEPS_PER_REV)) * TWO_PI - HALF_PI;

function draw() {
    background(28);
    const s = arduino && arduino.myStepper;   // shorthand for this frame's reads
    const pos = ready ? s.position : 0;
    const coilsFree = ready && !enabled;
    dispPos = lerp(dispPos, pos, 0.25);   // always track the step count; red = coils free

    push();
    translate(cx, cy);

    noFill(); stroke(70); strokeWeight(3);
    circle(0, 0, 2 * R);

    // target ghost
    if (ready) {
        const ta = angleFor(s.target);
        stroke(120, 200, 255, 90); strokeWeight(3);
        line(0, 0, cos(ta) * R, sin(ta) * R);
    }

    // arm — blue when driving, pulsing red when the coils are free (disabled)
    const a = angleFor(dispPos);
    if (coilsFree) {
        const p = 0.5 + 0.5 * sin(millis() / 300);
        noFill(); stroke(230, 80, 80, 70 + 150 * p); strokeWeight(4);
        circle(0, 0, 2 * R + 10);                        // pulsing red ring
        stroke(230, 80, 80, 150 + 105 * p); strokeWeight(6);
        line(0, 0, cos(a) * R, sin(a) * R);
        fill(230, 80, 80); noStroke(); circle(0, 0, 12);
    } else {
        stroke(120, 200, 255); strokeWeight(6);
        line(0, 0, cos(a) * R, sin(a) * R);
        fill(255); noStroke(); circle(0, 0, 12);
    }

    // whenDone pulse
    if (millis() < flashUntil) {
        const f = (flashUntil - millis()) / 700;
        noFill(); strokeWeight(4);
        stroke(flashOk ? color(90, 220, 130, 255 * f) : color(230, 90, 90, 255 * f));
        circle(0, 0, 2 * R + 26 * (1 - f));
    }
    // limit-switch trip pulse
    if (millis() < limitUntil) {
        const f = (limitUntil - millis()) / 900;
        noFill(); stroke(240, 150, 60, 255 * f); strokeWeight(4);
        circle(0, 0, 2 * R + 14);
    }
    pop();

    // readouts
    noStroke(); fill(230); textAlign(CENTER); textSize(20);
    text(ready ? `${Math.round(pos)} steps` : '—', cx, cy + R + 34);
    fill(150); textSize(12);
    const rev = ready ? (pos / s.stepsPerRev).toFixed(2) : '0';
    const spd = ready ? Math.round(s.speed) : 0;
    text(`${rev} rev   ·   speed ${spd}   ·   ${ready && s.isRunning ? 'moving' : 'idle'}`, cx, cy + R + 54);

    const sw = ready && s.switches ? `MIN:${s.switches.min ? '●' : '○'}  MAX:${s.switches.max ? '●' : '○'}` : '';
    let line3 = (ready ? `coils:${enabled ? 'on' : 'FREE'}   ` : '') + sw;
    if (ready && s.limitHit) line3 += `   hit:${s.limitHit}`;
    if (homing) line3 += '   HOMING…';
    fill(homing ? color(240, 210, 90) : (ready && !enabled ? color(210, 120, 120) : color(150)));
    text(line3, cx, cy + R + 72);
    textAlign(LEFT);
}
