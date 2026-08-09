// ==============================================================
// Stepper motor — full control panel (a Pardalote tool)
// Works out of the box: connection and wiring are set on the page
// (and remembered by this browser) — no code editing needed.
// Exercises the modern stepper API:
//   • moveTo / move / moveTo 0        — accel-limited position moves
//   • moveToTimed + whenDone          — arrive in ~duration; awaited
//   • runSpeed / stop / hardStop      — spin, smooth decel, instant halt
//   • enable / disable                — hold vs free the coils
//   • setLimits / clearLimits         — soft position limits
//   • setLimitSwitch + 'limit' event  — hardware end-stops
//   • setSwitchPosition               — where a switch sits vs. home
//   • setHome / home + 'homeFail'     — re-zero + seek-switch homing routine
// House style: see style.css — shared by every Pardalote example.
// by Scott Mitchell
// GPL-3.0 License
// ==============================================================

// --- Saved settings (browser localStorage) -----------------------------
// 'driver' = STEP/DIR (TMC2208/2209, A4988, EasyDriver)
// '4wire'  = 4 coil pins (28BYJ-48 via ULN2003, or bipolar via H-bridge /
//            dual-driver shield). Pin order matches AccelStepper FULL4WIRE.
const STORE = 'pardalote-stepper-motor';
const DEFAULTS = {
    ip: '192.168.x.x',
    mode: 'driver',              // 'driver' | '4wire'
    driverPins: [2, 3, 4],       // STEP, DIR, EN  (EN optional; -1 = none)
    wirePins: [8, 9, 10, 11],    // IN1..IN4
    maxSpeed: 800,               // steps/sec  (4-wire tops out ~300)
    accel: 800,                  // steps/sec^2 — also governs stop() decel
    stepsPerRev: 20,             // affects the dial's rev readout + jog size only
    transport: 'wifi',           // 'wifi' (IP) or 'usb' (Web Serial)
};
const saved = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORE) || '{}')) };
function persist() {
    saved.ip = ipIn.value().trim();
    saved.transport = (transportSelect.value() === 'USB') ? 'usb' : 'wifi';
    saved.mode = modeSel.value();
    if (saved.mode === 'driver') saved.driverPins = pinVals().slice(0, 3);
    else saved.wirePins = pinVals();
    saved.maxSpeed = int(msIn.value());
    saved.accel = int(accIn.value());
    saved.stepsPerRev = int(stepsRevIn.value());
    localStorage.setItem(STORE, JSON.stringify(saved));
}

// --- House palette (matches style.css / the website) -------------------
const INK = '#2B2420', GREY = '#6d6a5f', HAIR = '#d9d2c2',
      TEAL = '#3FA9A0', AMBER = '#E8A33D', ORANGE = '#D3542B';

const W = 560, H = 380, cx = W / 2, cy = H / 2 - 6, R = 120;

// The stepper is registered with Pardalote and addressed as arduino.myStepper
// throughout — no separate handle to keep in sync.
let arduino, ready = false;
let statusEl, logEl, logLines = [];

// settings controls
let ipIn, connectBtn, disconnectBtn, transportSelect, connectLbl, modeSel, pinIns = [], pinLbls = [];

// controls
let moveTarget, timedTarget, durSlider, durVal, speedSlider, speedVal,
    msIn, accIn, stepsRevIn, softMin, softMax, minPin, minTrig, maxPin, maxTrig,
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

    // Heading + status live in index.html (#top); the sketch just drives status.
    statusEl = select('#status');

    // Board — WiFi (IP) or USB (Web Serial), connect/disconnect
    let r = row(main, 'Board IP');
    connectLbl = r.elt.querySelector('.lbl');
    transportSelect = createSelect().parent(r);
    transportSelect.option('WiFi'); transportSelect.option('USB');
    transportSelect.elt.value = (saved.transport === 'usb') ? 'USB' : 'WiFi';
    transportSelect.changed(switchTransport);
    ipIn = createInput(saved.ip, 'text').parent(r);
    ipIn.style('width', '130px');
    connectBtn = btn(r, 'Connect', doConnect);
    connectBtn.addClass('primary');
    disconnectBtn = btn(r, 'Disconnect', doDisconnect);
    applyTransport();

    // Move (position)
    r = row(main, 'Move');
    btn(r, '−¼ turn', () => jog(-1));
    btn(r, '+¼ turn', () => jog(+1));
    btn(r, 'moveTo', () => { if (rdy()) { arduino.myStepper.moveTo(int(moveTarget.value())); log(`moveTo(${int(moveTarget.value())})`); } });
    moveTarget = num(r, 0, 72);

    // Timed move + whenDone
    r = row(main, 'Timed');
    btn(r, 'moveToTimed → whenDone', doTimed);
    createSpan('target').parent(r); timedTarget = num(r, 2000, 72);
    createSpan('over').parent(r);
    durSlider = createSlider(300, 4000, 1500, 100).parent(r);
    durVal = createSpan('1500 ms').parent(r);
    durSlider.input(() => durVal.html(durSlider.value() + ' ms'));

    // Spin (velocity)
    r = row(main, 'Spin');
    btn(r, 'runSpeed', () => { if (rdy()) { arduino.myStepper.runSpeed(speedSlider.value()); log(`runSpeed(${speedSlider.value()})`); } });
    speedSlider = createSlider(-saved.maxSpeed, saved.maxSpeed, Math.round(saved.maxSpeed / 2), 10).parent(r);
    speedVal = createSpan(String(Math.round(saved.maxSpeed / 2))).parent(r);
    speedSlider.input(() => speedVal.html(String(speedSlider.value())));
    btn(r, 'stop (decel)', () => { if (rdy()) { arduino.myStepper.stop(); log('stop() — decel ramp'); } });
    btn(r, 'hard stop', () => { if (rdy()) { arduino.myStepper.hardStop(); log('hardStop() — instant'); } });

    // Torque
    r = row(main, 'Torque');
    enableBtn  = btn(r, 'enable (hold)',  () => { if (rdy()) { arduino.myStepper.enable();  enabled = true;  refreshToggles(); log('enable()'); } });
    disableBtn = btn(r, 'disable (free)', () => { if (rdy()) { arduino.myStepper.disable(); enabled = false; refreshToggles(); log('disable() — coils free'); } });

    // Profile
    r = row(main, 'Profile');
    btn(r, 'apply', () => { if (rdy()) { arduino.myStepper.setMaxSpeed(int(msIn.value())); arduino.myStepper.setAcceleration(int(accIn.value())); arduino.myStepper.setStepsPerRev(int(stepsRevIn.value())); persist(); log(`setMaxSpeed(${int(msIn.value())}) setAcceleration(${int(accIn.value())}) setStepsPerRev(${int(stepsRevIn.value())})`); } });
    createSpan('maxSpeed').parent(r); msIn = num(r, saved.maxSpeed, 72);
    createSpan('accel').parent(r); accIn = num(r, saved.accel, 72);
    createSpan('steps/rev').parent(r); stepsRevIn = num(r, saved.stepsPerRev, 72);

    // Zero + soft limits
    r = row(main, 'Limits');
    btn(r, 'setPosition 0', () => { if (rdy()) { arduino.myStepper.setPosition(0); dispPos = 0; log('setPosition(0)'); } });
    createSpan('soft').parent(r); softMin = num(r, -3200); createSpan('to').parent(r); softMax = num(r, 3200);
    btn(r, 'set', () => { if (rdy()) { arduino.myStepper.setLimits(int(softMin.value()), int(softMax.value())); log(`setLimits(${int(softMin.value())}, ${int(softMax.value())})`); } });
    btn(r, 'clear', () => { if (rdy()) { arduino.myStepper.clearLimits(); log('clearLimits()'); } });

    // Home — home is the origin (0). setHome() re-zeros the frame: the current
    // position becomes 0 and the soft limits + switch positions shift with it.
    r = row(main, 'Home');
    btn(r, '→ 0', () => { if (rdy()) { arduino.myStepper.moveTo(0); log('moveTo(0)'); } });
    btn(r, 'home()', doHome);
    createSpan('speed').parent(r); homeSpeed = num(r, 0);
    createSpan('t/out').parent(r); homeTimeout = num(r, 0);
    btn(r, 'setHome (here → 0)', () => { if (rdy()) { arduino.myStepper.setHome(); log('setHome() — re-zero: here becomes 0'); } });
    btn(r, 'setHome(coord)', () => { if (rdy()) { arduino.myStepper.setHome(int(homeVal.value())); log(`setHome(${int(homeVal.value())}) — here becomes ${int(homeVal.value())}`); } });
    homeVal = num(r, 0);

    // --- the display ---
    createCanvas(W, H).parent(main);
    textFont('Poppins');

    // --- wiring, under the display (house rule: wiring goes under the display) ---
    r = row(main, 'Wiring');
    modeSel = createSelect().parent(r);
    modeSel.option('STEP/DIR driver', 'driver');
    modeSel.option('4 coil pins', '4wire');
    modeSel.selected(saved.mode);
    modeSel.changed(refreshPinFields);
    for (let i = 0; i < 4; i++) {
        pinLbls[i] = createSpan('').parent(r);
        pinIns[i] = num(r, 0, 56);
    }
    refreshPinFields();

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

    logEl = createDiv('').id('log').parent(main);

    arduino = new Arduino();
    arduino.add('myStepper', new Stepper());
    arduino.on('ready', () => { setConnected(true); onReady(); });
    arduino.on('disconnect', () => {
        ready = false;
        setConnected(false);
        if (usbBusy) { usbBusy = false; setStatus('board is on WiFi — press Connect to switch it to USB'); }
        else if (!manualDisconnect) setStatus('reconnecting…');
    });
    // 'usbBusy': a silent USB reconnect reached a board that's on WiFi — it won't
    // switch without a picker gesture. The 'disconnect' that follows shows the prompt.
    arduino.on('usbBusy', () => { usbBusy = true; });

    // Returning visit: reconnect with the remembered settings.
    if (localStorage.getItem(STORE)) doConnect();
    else setStatus("enter your board's IP and press Connect");
}

// -------------------------------------------------------------------
// Connection + wiring (from the on-page fields)
// -------------------------------------------------------------------
async function doConnect() {
    persist();
    manualDisconnect = false;
    ready = false;
    if (saved.transport === 'usb') {
        setStatus('connecting over USB…');
        await arduino.connectSerial(PROMPT);   // always show the port picker
        if (!arduino.socket) setStatus('press Connect and choose the USB port');
        return;
    }
    const ip = ipIn.value().trim();
    if (!ip || ip.includes('x')) { setStatus("enter your board's IP and press Connect"); return; }
    arduino.connect(ip);        // (re)connect — attach happens on 'ready'
    setStatus('connecting…');
}

let manualDisconnect = false;
let usbBusy = false;   // board on WiFi, silent USB reconnect refused (see 'usbBusy')

function doDisconnect() {
    manualDisconnect = true;
    ready = false;
    if (disconnectBtn) { disconnectBtn.html('Disconnecting…'); disconnectBtn.attribute('disabled', ''); }
    if (connectBtn) { connectBtn.html('Connect'); connectBtn.removeClass('connected').addClass('primary'); }
    arduino.disconnect();       // the 'disconnect' event restores the button when done
    setTimeout(() => setConnected(false), 3000);
    setStatus('disconnected — press Connect to resume');
    log('disconnect()');
}

// --- Connection standard (see PROJECT-STATUS) ---
function applyTransport() {
    const usb = (transportSelect.value() === 'USB');
    ipIn.style('display', usb ? 'none' : '');
    if (connectLbl) connectLbl.textContent = usb ? 'Board USB' : 'Board IP';
}
function setConnected(on) {
    if (connectBtn) {
        connectBtn.html(on ? 'Connected' : 'Connect');
        connectBtn.removeClass(on ? 'primary' : 'connected').addClass(on ? 'connected' : 'primary');
    }
    if (!on && disconnectBtn) { disconnectBtn.html('Disconnect'); disconnectBtn.removeAttribute('disabled'); }
}
// Flipping WiFi/USB drops the current connection — a browser holds ONE link.
function switchTransport() {
    manualDisconnect = true; ready = false;
    arduino.disconnect();
    setConnected(false);
    persist();
    applyTransport();
    setStatus('channel switched — press Connect');
}

function pinVals() { return pinIns.map(i => int(i.value())); }

let curMode = null;   // tracks which mode the pin fields currently show
function refreshPinFields() {
    // remember edits to the outgoing mode's pins before repopulating
    if (curMode === 'driver') saved.driverPins = pinVals().slice(0, 3);
    else if (curMode === '4wire') saved.wirePins = pinVals();
    curMode = modeSel.value();
    const driver = modeSel.value() === 'driver';
    const labels = driver ? ['STEP', 'DIR', 'EN (−1 none)'] : ['IN1', 'IN2', 'IN3', 'IN4'];
    const pins = driver ? saved.driverPins : saved.wirePins;
    for (let i = 0; i < 4; i++) {
        const show = i < labels.length;
        pinLbls[i].html(show ? labels[i] : '');
        pinLbls[i].style('display', show ? '' : 'none');
        pinIns[i].style('display', show ? '' : 'none');
        if (show && pins[i] !== undefined) pinIns[i].value(pins[i]);
    }
}

function onReady() {
    const pins = pinVals();
    if (modeSel.value() === '4wire') {
        arduino.myStepper.attach4wire(pins[0], pins[1], pins[2], pins[3]);
    } else if (pins[2] >= 0) {
        arduino.myStepper.attach(pins[0], pins[1], pins[2]);
    } else {
        arduino.myStepper.attach(pins[0], pins[1]);
    }
    arduino.myStepper.setMaxSpeed(int(msIn.value()));
    arduino.myStepper.setAcceleration(int(accIn.value()));
    arduino.myStepper.setStepsPerRev(int(stepsRevIn.value()));
    arduino.myStepper.setPosition(0);
    arduino.myStepper.read(100);                       // poll live position

    arduino.myStepper.on('limit', ({ which, position }) => {
        limitUntil = millis() + 900; limitWhich = which;
        log(`⚠ limit ${which} @ ${position}`);
    });
    arduino.myStepper.on('homeFail', ({ position }) => log(`⚠ homeFail @ ${position}`));

    dispPos = 0; ready = true;
    enabled = true; minSwSet = false; maxSwSet = false; refreshToggles();
    const mode = modeSel.value();
    setStatus(`ready — ${mode} on ${pins.slice(0, mode === '4wire' ? 4 : 3)}`);
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

// alpha'd copy of a palette colour, for ghosts and pulses
function tint255(hex, a) { const c = color(hex); c.setAlpha(a); return c; }

// -------------------------------------------------------------------
// Dial — full 360°, position → angle (0 at top, clockwise)
// House palette: ink ring, teal arm, amber target ghost / limit pulse,
// orange for anything alarming (coils free, timeouts).
// -------------------------------------------------------------------
const angleFor = pos => (pos / (arduino && arduino.myStepper ? arduino.myStepper.stepsPerRev : saved.stepsPerRev)) * TWO_PI - HALF_PI;

function draw() {
    background(255);
    const s = arduino && arduino.myStepper;   // shorthand for this frame's reads
    const pos = ready ? s.position : 0;
    const coilsFree = ready && !enabled;
    dispPos = lerp(dispPos, pos, 0.25);   // always track the step count

    push();
    translate(cx, cy);

    noFill(); stroke(HAIR); strokeWeight(2);
    circle(0, 0, 2 * R);

    // target ghost
    if (ready) {
        const ta = angleFor(s.target);
        stroke(tint255(AMBER, 160)); strokeWeight(3);
        line(0, 0, cos(ta) * R, sin(ta) * R);
    }

    // arm — teal when driving, pulsing orange when the coils are free (disabled)
    const a = angleFor(dispPos);
    if (coilsFree) {
        const p = 0.5 + 0.5 * sin(millis() / 300);
        noFill(); stroke(tint255(ORANGE, 60 + 120 * p)); strokeWeight(4);
        circle(0, 0, 2 * R + 10);                        // pulsing orange ring
        stroke(tint255(ORANGE, 150 + 105 * p)); strokeWeight(5);
        line(0, 0, cos(a) * R, sin(a) * R);
        fill(ORANGE); noStroke(); circle(0, 0, 12);
    } else {
        stroke(TEAL); strokeWeight(5);
        line(0, 0, cos(a) * R, sin(a) * R);
        fill(INK); noStroke(); circle(0, 0, 12);
    }

    // whenDone pulse
    if (millis() < flashUntil) {
        const f = (flashUntil - millis()) / 700;
        noFill(); strokeWeight(3);
        stroke(tint255(flashOk ? TEAL : ORANGE, 255 * f));
        circle(0, 0, 2 * R + 26 * (1 - f));
    }
    // limit-switch trip pulse
    if (millis() < limitUntil) {
        const f = (limitUntil - millis()) / 900;
        noFill(); stroke(tint255(AMBER, 255 * f)); strokeWeight(3);
        circle(0, 0, 2 * R + 14);
    }
    pop();

    // readouts
    noStroke(); fill(INK); textAlign(CENTER); textSize(20);
    text(ready ? `${Math.round(pos)} steps` : '—', cx, cy + R + 34);
    fill(GREY); textSize(12);
    const rev = ready ? (pos / s.stepsPerRev).toFixed(2) : '0';
    const spd = ready ? Math.round(s.speed) : 0;
    text(`${rev} rev   ·   speed ${spd}   ·   ${ready && s.isRunning ? 'moving' : 'idle'}`, cx, cy + R + 54);

    const sw = ready && s.switches ? `MIN:${s.switches.min ? '●' : '○'}  MAX:${s.switches.max ? '●' : '○'}` : '';
    let line3 = (ready ? `coils:${enabled ? 'on' : 'FREE'}   ` : '') + sw;
    if (ready && s.limitHit) line3 += `   hit:${s.limitHit}`;
    if (homing) line3 += '   HOMING…';
    fill(homing ? AMBER : (ready && !enabled ? ORANGE : GREY));
    text(line3, cx, cy + R + 72);
    textAlign(LEFT);
}
