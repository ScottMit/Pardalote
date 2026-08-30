// ==============================================================
// Servo control — full control panel (a Pardalote tool)
// Works out of the box: connection and wiring are set on the page
// (and remembered by this browser) — no code editing needed.
// Exercises the modern servo API:
//   • write()          — immediate move
//   • writeTimed()     — on-board interpolation over a duration
//   • whenDone()       — await real arrival (logged with elapsed ms)
//   • setLimits()      — soft limits clamped on the Arduino
//   • setHome()/home() — declare a home angle and glide to it
// House style: see style.css — shared by every Pardalote example.
// by Scott Mitchell
// GPL-3.0-or-later License
// ==============================================================

// --- Saved settings (browser localStorage) -----------------------------
const STORE = 'pardalote-servo-control';
const DEFAULTS = {
    ip: '192.168.x.x',
    pin: 11,   // ESP32: any LEDC-capable pin. Give the servo its own 5V supply + common ground.
    transport: 'wifi',   // 'wifi' (IP) or 'usb' (Web Serial)
};
const saved = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORE) || '{}')) };
function persist() {
    saved.ip = ipIn.value().trim();
    saved.pin = int(pinIn.value());
    saved.transport = (transportSelect.value() === 'USB') ? 'usb' : 'wifi';
    localStorage.setItem(STORE, JSON.stringify(saved));
}

// --- House palette (matches style.css / the website) -------------------
const INK = '#2B2420', GREY = '#6d6a5f', HAIR = '#d9d2c2',
      TEAL = '#3FA9A0', AMBER = '#E8A33D', ORANGE = '#D3542B';

const W = 520, H = 300, cx = W / 2, cy = 210, R = 120, D = 2 * R;

let arduino;
let ready = false;
let manualDisconnect = false;
let usbBusy = false;   // board on WiFi, silent USB reconnect refused (see 'usbBusy')

// Display interpolation so the gauge animates smoothly whether or not a
// timed move is running. A leg eases `from`→`to` (degrees) over moveDur ms.
let disp = 90, from = 90, to = 90, moveStart = 0, moveDur = 200;

// Soft-limit + home state, mirrored locally just for the on-screen readout.
let limMin = null, limMax = null, homeAngle = 90;

let statusEl, logEl, ipIn, pinIn, targetSlider, durSlider, durVal,
    minInput, maxInput, homeInput, transportSelect, connectBtn, disconnectBtn;
let logLines = [];

// Brief ring pulse when a whenDone() settles — teal = arrived, orange = timeout.
let flashUntil = 0, flashOk = true;
const flash = ok => { flashUntil = millis() + 700; flashOk = ok; };

const easeInOut = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function setup() {
    const main = select('main');

    // Heading + status live in index.html (#top); the sketch just drives status.
    statusEl = select('#status');

    // Board — WiFi (IP) or USB (Web Serial), connect/disconnect
    let r = row(main, 'Board');
    transportSelect = createSelect().parent(r);
    transportSelect.option('WiFi'); transportSelect.option('USB');
    transportSelect.elt.value = (saved.transport === 'usb') ? 'USB' : 'WiFi';
    transportSelect.changed(switchTransport);
    ipIn = createInput(saved.ip, 'text').parent(r);
    ipIn.style('width', '130px');
    connectBtn = createButton('Connect').parent(r).mousePressed(doConnect);
    connectBtn.addClass('primary');
    disconnectBtn = createButton('Disconnect').parent(r).mousePressed(doDisconnect);
    applyTransport();

    // Wiring — the servo pin (changing it reconnects), grouped with the settings
    r = row(main, 'Wiring');
    createSpan('servo pin').parent(r);
    pinIn = createInput(String(saved.pin), 'number').parent(r);
    pinIn.style('width', '56px');
    pinIn.changed(() => { if (arduino.connected) doConnect(); });

    // Immediate write
    r = row(main, 'Write');
    createButton('0°').parent(r).mousePressed(() => doWrite(0));
    createButton('center 90°').parent(r).mousePressed(() => doWrite(90));
    createButton('180°').parent(r).mousePressed(() => doWrite(180));

    // Timed move + whenDone
    r = row(main, 'Timed');
    createButton('writeTimed → whenDone').parent(r).mousePressed(doTimed);
    createSpan('target').parent(r);
    targetSlider = createSlider(0, 180, 120, 1).parent(r);
    createSpan('over').parent(r);
    durSlider = createSlider(300, 3000, 1500, 100).parent(r);
    durVal = createSpan('1500 ms').parent(r);
    durSlider.input(() => durVal.html(durSlider.value() + ' ms'));

    // Soft limits
    r = row(main, 'Limits');
    createButton('Set').parent(r).mousePressed(doSetLimits);
    minInput = createInput('20', 'number').parent(r);
    createSpan('to').parent(r);
    maxInput = createInput('160', 'number').parent(r);
    createButton('Clear').parent(r).mousePressed(doClearLimits);

    // Home
    r = row(main, 'Home');
    createButton('Home (snap)').parent(r).mousePressed(doHomeSnap);
    createButton('Home (1s)').parent(r).mousePressed(doHome);
    createButton('Set = here').parent(r).mousePressed(doSetHomeHere);
    createButton('Set = value').parent(r).mousePressed(doSetHomeValue);
    homeInput = createInput('45', 'number').parent(r);

    // --- the display ---
    createCanvas(W, H).parent(main);
    textFont('Poppins');

    logEl = createDiv('').id('log').parent(main);

    arduino = new Arduino();
    arduino.add('myServo', new Servo());
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

function doDisconnect() {
    manualDisconnect = true;
    ready = false;
    if (disconnectBtn) { disconnectBtn.html('Disconnecting…'); disconnectBtn.attribute('disabled', ''); }
    if (connectBtn) { connectBtn.html('Connect'); connectBtn.removeClass('connected').addClass('primary'); }
    arduino.disconnect();       // the 'disconnect' event restores the button when done
    setTimeout(() => setConnected(false), 3000);
    setStatus('disconnected — press Connect to resume');
}

// --- Connection standard (see PROJECT-STATUS) ---
// WiFi shows the IP field; USB hides it (the browser's port picker chooses).
function applyTransport() {
    const usb = (transportSelect.value() === 'USB');
    ipIn.style('display', usb ? 'none' : '');
}
// Green "Connected" when live, plain "Connect" otherwise; restore Disconnect.
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

// Attach INSIDE 'ready' (extension state is reset on every (re)connect).
function onReady() {
    arduino.myServo.attach(saved.pin);
    arduino.myServo.center();          // 90°
    snapTo(90);
    homeAngle = 90;
    limMin = limMax = null;
    ready = true;
    setStatus(`ready — servo on pin ${saved.pin}`);
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
// UI + display helpers
// -------------------------------------------------------------------
function row(parent, label) {
    const r = createDiv().class('row').parent(parent);
    createSpan(label).class('lbl').parent(r);
    return r;
}

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

// alpha'd copy of a palette colour, for pulses
function tint255(hex, a) { const c = color(hex); c.setAlpha(a); return c; }

// 0° → left (PI), 90° → up (1.5PI), 180° → right (TWO_PI)
const angleFor = deg => PI + (constrain(deg, 0, 180) / 180) * PI;

// -------------------------------------------------------------------
// Gauge — house palette: hairline track, teal arm + allowed band,
// amber home tick, orange for timeouts.
// -------------------------------------------------------------------
function draw() {
    background(255);

    const t = moveDur > 0 ? constrain((millis() - moveStart) / moveDur, 0, 1) : 1;
    disp = lerp(from, to, easeInOut(t));

    push();
    translate(cx, cy);

    // gauge track (top semicircle)
    noFill();
    stroke(HAIR); strokeWeight(2);
    arc(0, 0, D, D, PI, TWO_PI);

    // allowed band when limits are set
    if (limMin !== null) {
        stroke(TEAL); strokeWeight(3);
        arc(0, 0, D, D, angleFor(limMin), angleFor(limMax));
    }

    // home tick
    const ha = angleFor(homeAngle);
    stroke(AMBER); strokeWeight(2);
    line(cos(ha) * (R - 12), sin(ha) * (R - 12), cos(ha) * (R + 8), sin(ha) * (R + 8));

    // arm
    const a = angleFor(disp);
    stroke(ready ? TEAL : HAIR); strokeWeight(5);
    line(0, 0, cos(a) * R, sin(a) * R);
    fill(ready ? INK : GREY); noStroke(); circle(0, 0, 12);

    // whenDone pulse: a ring that expands and fades (teal = arrived, orange = timeout)
    if (millis() < flashUntil) {
        const f = (flashUntil - millis()) / 700;          // 1 → 0
        noFill(); strokeWeight(3);
        stroke(tint255(flashOk ? TEAL : ORANGE, 255 * f));
        circle(0, 0, D + 26 * (1 - f));
    }

    // readouts
    textAlign(CENTER);
    fill(INK); textSize(20);
    text(`${round(disp)}°`, 0, 42);
    fill(GREY); textSize(12);
    text(limMin === null ? 'limits: none' : `limits: ${limMin}–${limMax}°`, 0, 62);
    fill(AMBER);
    text(`home: ${homeAngle}°`, 0, 80);
    textAlign(LEFT);
    pop();
}
