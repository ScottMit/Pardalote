// ==============================================================
// Shared Servo Example
// The Arduino sketch created this servo — the browser gets it
// automatically as arduino.pan. No arduino.add(), no attach(), and no pin
// to set here (the sketch owns the wiring). Connection is set on the page
// (and remembered by this browser) — no code editing needed.
// House style: see style.css — shared by every Pardalote example.
// by Scott Mitchell
// GPL-3.0-or-later License
// ==============================================================

// --- Saved settings (browser localStorage) -----------------------------
const STORE = 'pardalote-shared-servo';
const DEFAULTS = { ip: '192.168.x.x', transport: 'wifi' };
const saved = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORE) || '{}')) };
function persist() {
    saved.ip = ipIn.value().trim();
    saved.transport = (transportSelect.value() === 'USB') ? 'usb' : 'wifi';
    localStorage.setItem(STORE, JSON.stringify(saved));
}

const W = 600, H = 340;

let arduino, ready = false, haveServo = false, statusEl;
let ipIn, transportSelect, connectBtn, disconnectBtn;
let manualDisconnect = false, usbBusy = false;

function setup() {
    const main = select('main');
    statusEl = select('#status');

    // Board — WiFi (IP) or USB (Web Serial), connect/disconnect
    let r = row(main, 'Board');
    transportSelect = createSelect().parent(r);
    transportSelect.option('WiFi'); transportSelect.option('USB');
    transportSelect.elt.value = (saved.transport === 'usb') ? 'USB' : 'WiFi';
    transportSelect.changed(switchTransport);
    ipIn = createInput(saved.ip, 'text').parent(r); ipIn.style('width', '130px');
    connectBtn = createButton('Connect').parent(r).mousePressed(doConnect).addClass('primary');
    disconnectBtn = createButton('Disconnect').parent(r).mousePressed(doDisconnect);
    applyTransport();

    // --- the display ---
    createCanvas(W, H).parent(main);
    textFont('Poppins');
    createDiv('The sketch nods the servo every 4 s. Press the mouse to take over; '
        + 'release to hand it back. The servo pin is set in the Arduino sketch.').class('hint').parent(main);

    arduino = new Arduino();
    // No arduino.add() — the sketch calls PardaloteServo.attach("pan", 9), so
    // arduino.pan simply exists by the time 'ready' fires.
    arduino.on('ready', onReady);
    arduino.on('disconnect', () => {
        ready = false; haveServo = false; setConnected(false);
        if (usbBusy) { usbBusy = false; setStatus('board is on WiFi — press Connect to switch it to USB'); }
        else if (!manualDisconnect) setStatus('reconnecting…');
    });
    arduino.on('usbBusy', () => { usbBusy = true; });
    // 'share': fires the moment the board announces a sketch-created object.
    arduino.on('share', ({ name }) => console.log(`Board created arduino.${name}`));

    // Returning visit: reconnect with the remembered settings.
    if (localStorage.getItem(STORE)) doConnect();
    else setStatus("enter your board's IP and press Connect");
}

function onReady() {
    setConnected(true);
    ready = true;
    haveServo = !!arduino.pan;
    if (!haveServo) { console.warn('The sketch did not create a "pan" servo'); setStatus('connected — waiting for the board’s "pan" servo'); }
    else setStatus('ready — move the mouse to take over');
}

function draw() {
    background(255);

    if (!haveServo) {
        fill('#6d6a5f'); noStroke(); textSize(14); textAlign(CENTER);
        text(ready ? 'Waiting for the board’s servo…' : 'Connect to begin', width / 2, 160);
        textAlign(LEFT);
        return;
    }

    // Take over while the mouse is pressed — a plain Servo write, the same call
    // you'd make on a browser-created servo. (Ignore clicks in the control rows.)
    if (mouseIsPressed && mouseY >= 0 && mouseY <= height && mouseX >= 0 && mouseX <= width) {
        arduino.pan.write(map(constrain(mouseX, 0, width), 0, width, 0, 180));
    }

    // arduino.pan.angle tracks BOTH sides' writes: browser writes set it, and
    // sketch writes are auto-echoed into it.
    drawServo(arduino.pan.angle);
}

function drawServo(angle) {
    // house palette: hairline track, teal arm, ink hub
    push();
    translate(width / 2, 230);
    stroke('#d9d2c2'); strokeWeight(2); noFill();
    arc(0, 0, 220, 220, PI, TWO_PI);
    stroke('#3FA9A0'); strokeWeight(5);
    const a = radians(180 - angle);
    line(0, 0, 110 * cos(a), -110 * sin(a));
    fill('#2B2420'); noStroke(); circle(0, 0, 12);
    textAlign(CENTER); textSize(18);
    text(`${round(angle)}°`, 0, 44);
    textAlign(LEFT);
    pop();
}

// -------------------------------------------------------------------
// Connection standard (see PROJECT-STATUS; duplicated per example)
// -------------------------------------------------------------------
async function doConnect() {
    persist();
    manualDisconnect = false; ready = false;
    if (saved.transport === 'usb') {
        setStatus('connecting over USB…');
        await arduino.connectSerial(PROMPT);   // always show the port picker
        if (!arduino.socket) setStatus('press Connect and choose the USB port');
        return;
    }
    const ip = ipIn.value().trim();
    if (!ip || ip.includes('x')) { setStatus("enter your board's IP and press Connect"); return; }
    arduino.connect(ip); setStatus('connecting…');
}
function doDisconnect() {
    manualDisconnect = true; ready = false;
    if (disconnectBtn) { disconnectBtn.html('Disconnecting…'); disconnectBtn.attribute('disabled', ''); }
    if (connectBtn) { connectBtn.html('Connect'); connectBtn.removeClass('connected').addClass('primary'); }
    arduino.disconnect();
    setTimeout(() => setConnected(false), 3000);
    setStatus('disconnected — press Connect to resume');
}
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
    arduino.disconnect(); setConnected(false);
    persist(); applyTransport();
    setStatus('channel switched — press Connect');
}

function setStatus(s) { if (statusEl) statusEl.html('status: ' + s); }
function row(parent, label) {
    const r = createDiv().class('row').parent(parent);
    createSpan(label).class('lbl').parent(r);
    return r;
}
