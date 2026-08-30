// ==============================================================
// Potentiometer — p5.js + Pardalote
// Read an analog input and draw with it: turn the knob and the circle
// grows and shrinks in real time. Connection and the pot's pin are set on
// the page (and remembered by this browser) — no code editing needed.
// House style: see style.css — shared by every Pardalote example.
// by Scott Mitchell
// GPL-3.0-or-later License
// ==============================================================

// --- Saved settings (browser localStorage) -----------------------------
const STORE = 'pardalote-potentiometer';
const DEFAULTS = {
    ip: '192.168.x.x',
    transport: 'wifi',   // 'wifi' (IP) or 'usb' (Web Serial)
    pin: 14,             // pot wiper pin — UNO IO 14 (A0) / ESP32 IO 36
};
const saved = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORE) || '{}')) };
function persist() {
    saved.ip = ipIn.value().trim();
    saved.transport = (transportSelect.value() === 'USB') ? 'usb' : 'wifi';
    saved.pin = int(pinIn.value());
    localStorage.setItem(STORE, JSON.stringify(saved));
}

const W = 600, H = 600;

let arduino, ready = false, statusEl;
let ipIn, transportSelect, connectBtn, disconnectBtn, pinIn;
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
    createSpan('pot pin').parent(r);
    pinIn = createInput(String(saved.pin), 'number').parent(r); pinIn.style('width', '56px');
    pinIn.changed(() => { persist(); if (ready) onReady(); });

    // --- the display ---
    createCanvas(W, H).parent(main);

    arduino = new Arduino();
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

// Configure the pot pin INSIDE 'ready' (pin state resets on every reconnect).
function onReady() {
    arduino.pinMode(saved.pin, ANALOG_INPUT_MODE, 50);   // read every 50 ms
    ready = true;
    setStatus(`ready — pot on pin ${saved.pin}`);
}

function draw() {
    background(255);

    // get reading from the Arduino (0 until connected)
    const dial = arduino ? arduino.analogRead(saved.pin) : 0;
    const circleRadius = map(dial, 0, arduino.analogMax || 1023, 10, 300);
    // UNO ADC range is 0–1023; ESP32 is 0–4095 (arduino.analogMax tracks the board)

    // draw circle — teal when connected, orange when not
    noStroke();
    fill(arduino && arduino.connected ? '#3FA9A0' : '#D3542B');
    circle(width / 2, height / 2, circleRadius * 2);
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
