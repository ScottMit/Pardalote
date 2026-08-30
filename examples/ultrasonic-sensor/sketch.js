// ==============================================================
// Ultrasonic sensor — p5.js + Pardalote
// Read an HC-SR04 distance sensor and visualise it: the bar fills (and shifts
// teal → orange) as an object gets closer. Connection and the trig/echo pins
// are set on the page (and remembered by this browser) — no code editing needed.
// House style: see style.css — shared by every Pardalote example.
// by Scott Mitchell
// GPL-3.0-or-later License
// ==============================================================

// --- Saved settings (browser localStorage) -----------------------------
const STORE = 'pardalote-ultrasonic';
const DEFAULTS = {
    ip: '192.168.x.x',
    transport: 'wifi',   // 'wifi' (IP) or 'usb' (Web Serial)
    trig: 12, echo: 14,  // HC-SR04 trigger / echo pins
};
const saved = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORE) || '{}')) };
function persist() {
    saved.ip = ipIn.value().trim();
    saved.transport = (transportSelect.value() === 'USB') ? 'usb' : 'wifi';
    saved.trig = int(trigIn.value());
    saved.echo = int(echoIn.value());
    localStorage.setItem(STORE, JSON.stringify(saved));
}

const W = 600, H = 500;
const maxDistance = 200;   // max distance to display (cm)

// House palette
const INK = '#2B2420', GREY = '#6d6a5f', HAIR = '#d9d2c2',
      TEAL = '#3FA9A0', ORANGE = '#D3542B';

let arduino, ready = false, statusEl;
let ipIn, transportSelect, connectBtn, disconnectBtn, trigIn, echoIn;
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

    // --- wiring, with the other settings above the display ---
    r = row(main, 'Wiring');
    createSpan('trig pin').parent(r);
    trigIn = createInput(String(saved.trig), 'number').parent(r); trigIn.style('width', '56px');
    createSpan('echo pin').parent(r);
    echoIn = createInput(String(saved.echo), 'number').parent(r); echoIn.style('width', '56px');
    const applyWiring = () => { persist(); if (ready) onReady(); };
    trigIn.changed(applyWiring); echoIn.changed(applyWiring);

    // --- the display ---
    createCanvas(W, H).parent(main);
    textFont('Poppins');

    // connect to Arduino + register the sensor
    arduino = new Arduino();
    arduino.add('ultrasonicSensor', new Ultrasonic());
    arduino.on('ready', () => { setConnected(true); onReady(); });
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

// Attach the sensor INSIDE 'ready' (device state resets on every reconnect).
function onReady() {
    arduino.ultrasonicSensor.attach(saved.trig, saved.echo);   // trig pin, echo pin
    arduino.ultrasonicSensor.setTimeout(40);   // ~600 cm ceiling
    arduino.ultrasonicSensor.read(200, CM);    // poll ms, unit CM or INCH
    ready = true;
    setStatus(`ready — trig ${saved.trig}, echo ${saved.echo}`);
}

function draw() {
    background(255);
    const cm = ready ? arduino.ultrasonicSensor.read() : 0;
    const distance = constrain(cm, 0, maxDistance);
    drawDistanceBar(distance);
    drawUI(distance);
}

function drawDistanceBar(distance) {
    const barWidth = 60, barHeight = height - 100, barX = 400, barY = 50;

    // Bar track
    noFill();
    stroke(INK); strokeWeight(1.5);
    rect(barX, barY, barWidth, barHeight);

    // Distance indicator — teal far away, orange up close
    if (distance > 0 && distance <= maxDistance) {
        const barFill = map(distance, 0, maxDistance, barHeight, 0);
        const c = lerpColor(color(ORANGE), color(TEAL), distance / maxDistance);
        noStroke(); fill(c);
        rect(barX, barY + barFill, barWidth, barHeight - barFill);
    }

    // Scale markers
    stroke(HAIR); fill(GREY);
    textAlign(RIGHT); textSize(10);
    for (let i = 0; i <= maxDistance; i += 50) {
        const y = map(i, 0, maxDistance, barY + barHeight, barY);
        line(barX + barWidth, y, barX + barWidth + 5, y);
        noStroke();
        text(i, barX + barWidth + 28, y + 3);
        stroke(HAIR);
    }
}

function drawUI(distance) {
    noStroke();
    textAlign(LEFT);
    if (arduino.connected) {
        fill(TEAL); textSize(14);
        text('connected', 20, 50);
        if (distance > 0) {
            fill(INK); textSize(28);
            text(distance.toFixed(1) + ' cm', 20, 96);
        } else {
            fill(GREY); textSize(14);
            text('No object detected or out of range', 20, 90);
        }
    } else {
        fill(ORANGE); textSize(14);
        text('waiting for connection…', 20, 50);
    }
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
